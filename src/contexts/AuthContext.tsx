import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { desktopApi } from "@/lib/desktopApi";
import {
  readLocalAccounts,
  writeLocalAccounts,
  readLocalSessionEmail,
  writeLocalSessionEmail,
  localAuthChangedEventName,
  type LocalAuthAccount,
} from "@/lib/localAuthStore";
import { readLocalSubscriptionProfile } from "@/lib/localSubscriptionLicense";

export type UserRole =
  | "admin"
  | "manager"
  | "receptionist"
  | "accountant"
  | "housekeeping"
  | "barman";

export type BusinessType = "hotel" | "retail" | "mixed" | "restaurant" | "sacco" | "school" | "manufacturing" | "vsla" | "other";
export type SubscriptionStatus = "trial" | "active" | "past_due" | "cancelled" | "expired" | "none";

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administrator",
  manager: "Manager",
  receptionist: "Receptionist",
  accountant: "Accountant",
  housekeeping: "Housekeeping",
  barman: "Barman",
};

interface AuthUser {
  id: string;
  email: string;
  role?: UserRole;
  full_name?: string;
  phone?: string;
  /** Platform super user — organizations & subscriptions console */
  isSuperAdmin?: boolean;
  /** Has a staff row (hotel property workspace) */
  isHotelStaff?: boolean;
  organization_id?: string | null;
  business_type?: BusinessType | null;
  subscription_status?: SubscriptionStatus;
  subscription_plan_id?: string | null;
  subscription_plan_code?: string | null;
  subscription_period_end?: string | null;
  /** Platform enables per organization; gates Fixed assets navigation. */
  enable_fixed_assets?: boolean;
  /** Platform: Communications hub (SMS/WhatsApp). */
  enable_communications?: boolean;
  /** Platform: Wallet module. */
  enable_wallet?: boolean;
  /** Platform: Payroll module toggle. */
  enable_payroll?: boolean;
  /** Platform: Budget module toggle. */
  enable_budget?: boolean;
  /** Platform: Agent Hub module toggle. */
  enable_agent?: boolean;
  enable_reports?: boolean;
  enable_accounting?: boolean;
  enable_inventory?: boolean;
  enable_purchases?: boolean;
  /** Platform: automated hotel room charges (check-in + night audit). When false, room revenue is manual. */
  hotel_enable_smart_room_charges?: boolean;
  /** School tenants: platform toggles for BOAT-linked areas. */
  school_enable_reports?: boolean;
  school_enable_fixed_deposit?: boolean;
  school_enable_accounting?: boolean;
  school_enable_inventory?: boolean;
  school_enable_purchases?: boolean;
  license_device_allowed?: boolean;
  license_device_reason?: string | null;
  subscription_last_validated_at?: number | null;
  subscription_validation_stale?: boolean;
  subscription_grace_ms_remaining?: number | null;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  isSuperAdmin: boolean;
  isHotelStaff: boolean;
  /** True when user landed from password reset email and must set a new password */
  pendingPasswordReset: boolean;
  refreshUserFlags: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
    role: UserRole,
    phone?: string
  ) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  /** Send password reset email */
  resetPasswordForEmail: (email: string) => Promise<{ error: Error | null }>;
  /** Set new password after recovery link; then completes login */
  setNewPassword: (newPassword: string) => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SUBSCRIPTION_CACHE_KEY_PREFIX = "boat.subscription.cache.v1";
const SUBSCRIPTION_GRACE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const SUBSCRIPTION_RECHECK_MS = 6 * 60 * 60 * 1000; // 6 hours
const LOCAL_AUTH_ENABLED = (import.meta.env.VITE_LOCAL_AUTH || "").trim().toLowerCase();
const IS_LOCAL_AUTH_MODE =
  LOCAL_AUTH_ENABLED === "true" || LOCAL_AUTH_ENABLED === "1" || LOCAL_AUTH_ENABLED === "yes";
const LOCAL_BUSINESS_TYPE = (import.meta.env.VITE_LOCAL_BUSINESS_TYPE || "").trim().toLowerCase();
const LOCAL_ORGANIZATION_ID = (import.meta.env.VITE_LOCAL_ORGANIZATION_ID || "").trim();
const DEFAULT_LOCAL_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000001";
const LOCAL_SUPERADMIN_EMAILS = (import.meta.env.VITE_LOCAL_SUPERADMIN_EMAILS || "")
  .split(",")
  .map((v) => v.trim().toLowerCase())
  .filter(Boolean);

function parseLocalBusinessType(value: string): BusinessType {
  const allowed: BusinessType[] = ["hotel", "retail", "mixed", "restaurant", "sacco", "school", "manufacturing", "vsla", "other"];
  if ((allowed as string[]).includes(value)) return value as BusinessType;
  return "retail";
}

function parseLocalBool(value: string | undefined, fallback: boolean): boolean {
  const normalized = (value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function isLocalSuperAdminEmail(email: string): boolean {
  return LOCAL_SUPERADMIN_EMAILS.includes(email.trim().toLowerCase());
}

type TenantProfile = {
  organization_id: string | null;
  business_type: BusinessType | null;
  subscription_status: SubscriptionStatus;
  subscription_plan_id: string | null;
  subscription_plan_code: string | null;
  subscription_period_end: string | null;
  enable_fixed_assets: boolean;
  enable_communications: boolean;
  enable_wallet: boolean;
  enable_payroll: boolean;
  enable_budget: boolean;
  enable_agent: boolean;
  enable_reports: boolean;
  enable_accounting: boolean;
  enable_inventory: boolean;
  enable_purchases: boolean;
  hotel_enable_smart_room_charges: boolean;
  school_enable_reports: boolean;
  school_enable_fixed_deposit: boolean;
  school_enable_accounting: boolean;
  school_enable_inventory: boolean;
  school_enable_purchases: boolean;
  license_device_allowed: boolean;
  license_device_reason: string | null;
};

type CachedTenantProfile = {
  lastValidatedAt: number;
  tenant: TenantProfile;
};

function subscriptionCacheKey(userId: string): string {
  return `${SUBSCRIPTION_CACHE_KEY_PREFIX}:${userId}`;
}

function readTenantCache(userId: string): CachedTenantProfile | null {
  try {
    const raw = window.localStorage.getItem(subscriptionCacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedTenantProfile>;
    if (!parsed || typeof parsed.lastValidatedAt !== "number" || !parsed.tenant) return null;
    return parsed as CachedTenantProfile;
  } catch {
    return null;
  }
}

function writeTenantCache(userId: string, tenant: TenantProfile): void {
  try {
    const payload: CachedTenantProfile = {
      lastValidatedAt: Date.now(),
      tenant,
    };
    window.localStorage.setItem(subscriptionCacheKey(userId), JSON.stringify(payload));
  } catch {
    // Ignore cache write errors; auth flow should not fail for storage quota/privacy mode.
  }
}

function isCacheExpired(lastValidatedAt: number): boolean {
  return Date.now() - lastValidatedAt > SUBSCRIPTION_GRACE_MS;
}

function graceMsRemaining(lastValidatedAt: number): number {
  return Math.max(0, SUBSCRIPTION_GRACE_MS - (Date.now() - lastValidatedAt));
}

function forceReadOnlyTenant(tenant: TenantProfile): TenantProfile {
  return {
    ...tenant,
    subscription_status: "expired",
  };
}

function localTenantDefaults(): TenantProfile {
  const businessType = parseLocalBusinessType(LOCAL_BUSINESS_TYPE);
  const organizationId = LOCAL_ORGANIZATION_ID || DEFAULT_LOCAL_ORGANIZATION_ID;
  const localSubscription = readLocalSubscriptionProfile(organizationId);
  return {
    organization_id: organizationId,
    business_type: businessType,
    subscription_status: localSubscription?.status ?? "active",
    subscription_plan_id: "local-plan",
    subscription_plan_code: localSubscription?.plan_code ?? "desktop-local",
    subscription_period_end: localSubscription?.period_end ?? null,
    enable_fixed_assets: parseLocalBool(import.meta.env.VITE_LOCAL_ENABLE_FIXED_ASSETS, true),
    enable_communications: parseLocalBool(import.meta.env.VITE_LOCAL_ENABLE_COMMUNICATIONS, true),
    enable_wallet: parseLocalBool(import.meta.env.VITE_LOCAL_ENABLE_WALLET, true),
    enable_payroll: parseLocalBool(import.meta.env.VITE_LOCAL_ENABLE_PAYROLL, true),
    enable_budget: parseLocalBool(import.meta.env.VITE_LOCAL_ENABLE_BUDGET, true),
    enable_agent: parseLocalBool(import.meta.env.VITE_LOCAL_ENABLE_AGENT, true),
    enable_reports: parseLocalBool(import.meta.env.VITE_LOCAL_ENABLE_REPORTS, true),
    enable_accounting: parseLocalBool(import.meta.env.VITE_LOCAL_ENABLE_ACCOUNTING, true),
    enable_inventory: parseLocalBool(import.meta.env.VITE_LOCAL_ENABLE_INVENTORY, true),
    enable_purchases: parseLocalBool(import.meta.env.VITE_LOCAL_ENABLE_PURCHASES, true),
    hotel_enable_smart_room_charges: true,
    school_enable_reports: true,
    school_enable_fixed_deposit: true,
    school_enable_accounting: true,
    school_enable_inventory: true,
    school_enable_purchases: true,
    license_device_allowed: true,
    license_device_reason: null,
  };
}

async function ensureLocalSqliteStaffRow(account: LocalAuthAccount) {
  if (!IS_LOCAL_AUTH_MODE || !desktopApi.isAvailable()) return;
  try {
    const { data: existing } = await supabase
      .from("staff")
      .select("id")
      .eq("id", account.id)
      .maybeSingle();
    if (existing && (existing as { id?: string }).id) return;
    const orgId = LOCAL_ORGANIZATION_ID || DEFAULT_LOCAL_ORGANIZATION_ID;
    const { error } = await supabase.from("staff").insert({
      id: account.id,
      full_name: account.full_name || "",
      email: account.email,
      phone: account.phone || null,
      role: (account.role as UserRole) || "receptionist",
      is_active: true,
      organization_id: orgId,
      created_at: account.created_at,
    });
    if (error) console.warn("[BOAT] Local staff mirror insert failed:", error);
  } catch (e) {
    console.warn("[BOAT] ensureLocalSqliteStaffRow", e);
  }
}

function toLocalAuthUser(account: LocalAuthAccount): AuthUser {
  const isSuperAdmin = isLocalSuperAdminEmail(account.email);
  return {
    id: account.id,
    email: account.email,
    role: (account.role as UserRole | undefined) || undefined,
    full_name: account.full_name,
    phone: account.phone,
    isSuperAdmin,
    isHotelStaff: true,
    ...localTenantDefaults(),
    subscription_last_validated_at: Date.now(),
    subscription_validation_stale: false,
    subscription_grace_ms_remaining: null,
  };
}

async function enforceDesktopSeatLimit(
  organizationId: string,
  deviceLimit: number
): Promise<{ allowed: boolean; reason: string | null }> {
  if (!desktopApi.isAvailable()) {
    return { allowed: true, reason: null };
  }
  const deviceId = await desktopApi.getDeviceId();
  if (!deviceId) {
    return { allowed: false, reason: "Unable to validate this device license." };
  }

  const nowIso = new Date().toISOString();
  const deviceLabel =
    typeof navigator === "undefined"
      ? "desktop"
      : `${navigator.platform || "desktop"} | ${navigator.userAgent || "unknown"}`.slice(0, 180);

  const { data: existing, error: existingError } = await supabase
    .from("organization_license_devices")
    .select("id,revoked_at")
    .eq("organization_id", organizationId)
    .eq("device_id", deviceId)
    .maybeSingle();
  if (existingError) throw existingError;

  if (existing?.id) {
    if (existing.revoked_at) {
      return {
        allowed: false,
        reason: "This device is not authorized for the current BOAT subscription.",
      };
    }
    await supabase.from("organization_license_devices").update({ last_seen_at: nowIso }).eq("id", existing.id);
    return { allowed: true, reason: null };
  }

  const { count, error: countError } = await supabase
    .from("organization_license_devices")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .is("revoked_at", null);
  if (countError) throw countError;

  if ((count || 0) >= deviceLimit) {
    return {
      allowed: false,
      reason: `Device seat limit reached (${deviceLimit}). Contact BOAT support to transfer or add a seat.`,
    };
  }

  const { error: insertError } = await supabase.from("organization_license_devices").insert({
    organization_id: organizationId,
    device_id: deviceId,
    device_label: deviceLabel,
    first_seen_at: nowIso,
    last_seen_at: nowIso,
  });
  if (insertError) throw insertError;
  return { allowed: true, reason: null };
}

async function loadUserFlags(userId: string): Promise<{ isSuperAdmin: boolean; isHotelStaff: boolean }> {
  const [adminRes, staffRes] = await Promise.all([
    supabase.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle(),
    supabase.from("staff").select("id").eq("id", userId).maybeSingle(),
  ]);
  return {
    isSuperAdmin: !!adminRes.data,
    isHotelStaff: !!staffRes.data,
  };
}

async function loadTenantProfile(userId: string): Promise<TenantProfile> {
  const empty = {
    organization_id: null,
    business_type: null,
    subscription_status: "none" as SubscriptionStatus,
    subscription_plan_id: null,
    subscription_plan_code: null,
    subscription_period_end: null,
    enable_fixed_assets: false,
    enable_communications: true,
    enable_wallet: true,
    enable_payroll: true,
    enable_budget: true,
    enable_agent: true,
    enable_reports: true,
    enable_accounting: true,
    enable_inventory: true,
    enable_purchases: true,
    hotel_enable_smart_room_charges: true,
    school_enable_reports: false,
    school_enable_fixed_deposit: false,
    school_enable_accounting: false,
    school_enable_inventory: false,
    school_enable_purchases: false,
    license_device_allowed: true,
    license_device_reason: null,
  };

  try {
    const { data: staffRow, error: staffError } = await supabase
      .from("staff")
      .select("organization_id")
      .eq("id", userId)
      .maybeSingle();
    if (staffError) throw staffError;
    const organization_id = (staffRow as { organization_id?: string | null } | null)?.organization_id ?? null;
    if (!organization_id) {
      writeTenantCache(userId, empty);
      return empty;
    }

    const [{ data: orgRow, error: orgError }, { data: subRows, error: subError }] = await Promise.all([
      supabase
        .from("organizations")
        .select(
          "business_type, desktop_device_limit, enable_fixed_assets, enable_communications, enable_wallet, enable_payroll, enable_budget, enable_agent, enable_reports, enable_accounting, enable_inventory, enable_purchases, hotel_enable_smart_room_charges, school_enable_reports, school_enable_fixed_deposit, school_enable_accounting, school_enable_inventory, school_enable_purchases"
        )
        .eq("id", organization_id)
        .maybeSingle(),
      supabase
        .from("organization_subscriptions")
        .select("status,period_end,plan_id,subscription_plans(code)")
        .eq("organization_id", organization_id)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    if (orgError) throw orgError;
    if (subError) throw subError;

    const sub = (subRows || [])[0] as
      | {
          status?: string | null;
          period_end?: string | null;
          plan_id?: string | null;
          subscription_plans?: { code?: string | null } | null;
        }
      | undefined;

    const org = orgRow as {
      business_type?: BusinessType | null;
      desktop_device_limit?: number | null;
      enable_fixed_assets?: boolean | null;
      enable_communications?: boolean | null;
      enable_wallet?: boolean | null;
      enable_payroll?: boolean | null;
      enable_budget?: boolean | null;
      enable_agent?: boolean | null;
      enable_reports?: boolean | null;
      enable_accounting?: boolean | null;
      enable_inventory?: boolean | null;
      enable_purchases?: boolean | null;
      hotel_enable_smart_room_charges?: boolean | null;
      school_enable_reports?: boolean | null;
      school_enable_fixed_deposit?: boolean | null;
      school_enable_accounting?: boolean | null;
      school_enable_inventory?: boolean | null;
      school_enable_purchases?: boolean | null;
    } | null;

    const deviceLimit = Math.max(1, Number(org?.desktop_device_limit ?? 1));
    const seatCheck = await enforceDesktopSeatLimit(organization_id, deviceLimit);
    const effectiveSubscriptionStatus = seatCheck.allowed
      ? ((sub?.status as SubscriptionStatus | undefined) ?? "none")
      : "expired";

    const resolved: TenantProfile = {
      organization_id,
      business_type: (org?.business_type ?? null) as BusinessType | null,
      subscription_status: effectiveSubscriptionStatus,
      subscription_plan_id: sub?.plan_id ?? null,
      subscription_plan_code: sub?.subscription_plans?.code ?? null,
      subscription_period_end: sub?.period_end ?? null,
      enable_fixed_assets: !!org?.enable_fixed_assets,
      enable_communications: org?.enable_communications !== false,
      enable_wallet: org?.enable_wallet !== false,
      enable_payroll: org?.enable_payroll !== false,
      enable_budget: org?.enable_budget !== false,
      enable_agent: org?.enable_agent !== false,
      enable_reports: org?.enable_reports !== false,
      enable_accounting: org?.enable_accounting !== false,
      enable_inventory: org?.enable_inventory !== false,
      enable_purchases: org?.enable_purchases !== false,
      hotel_enable_smart_room_charges: org?.hotel_enable_smart_room_charges !== false,
      school_enable_reports: !!org?.school_enable_reports,
      school_enable_fixed_deposit: !!org?.school_enable_fixed_deposit,
      school_enable_accounting: !!org?.school_enable_accounting,
      school_enable_inventory: !!org?.school_enable_inventory,
      school_enable_purchases: !!org?.school_enable_purchases,
      license_device_allowed: seatCheck.allowed,
      license_device_reason: seatCheck.reason,
    };
    writeTenantCache(userId, resolved);
    return resolved;
  } catch {
    // Offline or API failure: allow temporary cached access only within grace period.
    const cached = readTenantCache(userId);
    if (!cached) return forceReadOnlyTenant(empty);
    if (isCacheExpired(cached.lastValidatedAt)) {
      return forceReadOnlyTenant(cached.tenant);
    }
    return cached.tenant;
  }
}

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingPasswordReset, setPendingPasswordReset] = useState(false);

  const getSubscriptionCacheMeta = useCallback((userId: string) => {
    const cached = readTenantCache(userId);
    if (!cached) {
      return {
        subscription_last_validated_at: null,
        subscription_validation_stale: true,
        subscription_grace_ms_remaining: 0,
      };
    }
    const remaining = graceMsRemaining(cached.lastValidatedAt);
    return {
      subscription_last_validated_at: cached.lastValidatedAt,
      subscription_validation_stale: isCacheExpired(cached.lastValidatedAt),
      subscription_grace_ms_remaining: remaining,
    };
  }, []);

  const applySessionUser = useCallback(async (sessionUser: { id: string; email?: string } | null) => {
    if (!sessionUser?.email) {
      setUser(null);
      return;
    }
    const meta = sessionUser as { user_metadata?: Record<string, unknown> };
    const [flags, tenant] = await Promise.all([
      loadUserFlags(sessionUser.id),
      loadTenantProfile(sessionUser.id),
    ]);
    const subscriptionCacheMeta = getSubscriptionCacheMeta(sessionUser.id);
    setUser({
      id: sessionUser.id,
      email: sessionUser.email,
      role: meta.user_metadata?.role as UserRole | undefined,
      full_name: meta.user_metadata?.full_name as string | undefined,
      phone: meta.user_metadata?.phone as string | undefined,
      ...flags,
      ...tenant,
      ...subscriptionCacheMeta,
    });
  }, [getSubscriptionCacheMeta]);

  const refreshUserFlags = useCallback(async () => {
    if (IS_LOCAL_AUTH_MODE) {
      const sessionEmail = readLocalSessionEmail();
      if (!sessionEmail) {
        setUser(null);
        return;
      }
      const account = readLocalAccounts().find((a) => a.email.toLowerCase() === sessionEmail.toLowerCase());
      setUser(account ? toLocalAuthUser(account) : null);
      return;
    }
    if (!user?.id) return;
    const [flags, tenant] = await Promise.all([
      loadUserFlags(user.id),
      loadTenantProfile(user.id),
    ]);
    const subscriptionCacheMeta = getSubscriptionCacheMeta(user.id);
    setUser((u) => (u ? { ...u, ...flags, ...tenant, ...subscriptionCacheMeta } : null));
  }, [getSubscriptionCacheMeta, user?.id]);

  useEffect(() => {
    if (IS_LOCAL_AUTH_MODE) {
      const hydrateLocalUser = async () => {
        const sessionEmail = readLocalSessionEmail();
        const accounts = readLocalAccounts();
        const account = accounts.find((a) => a.email.toLowerCase() === (sessionEmail || "").toLowerCase());
        let effectiveAccount = account ?? null;
        if (account?.id) {
          try {
            const { data: staffRow } = await supabase
              .from("staff")
              .select("full_name,phone,role")
              .eq("id", account.id)
              .maybeSingle();
            const row = (staffRow as { full_name?: string | null; phone?: string | null; role?: string | null } | null) ?? null;
            if (row) {
              effectiveAccount = {
                ...account,
                full_name: row.full_name ?? account.full_name,
                phone: row.phone ?? account.phone,
                role: row.role ?? account.role,
              };
              const nextAccounts = accounts.map((a) => (a.id === account.id ? effectiveAccount! : a));
              writeLocalAccounts(nextAccounts);
            }
          } catch {
            // keep local account fallback when local DB query fails
          }
        }
        setUser(effectiveAccount ? toLocalAuthUser(effectiveAccount) : null);
        setLoading(false);
        if (effectiveAccount) {
          await ensureLocalSqliteStaffRow(effectiveAccount);
        }
      };
      void hydrateLocalUser();
      const eventName = localAuthChangedEventName();
      const onLocalAuthChanged = () => {
        void hydrateLocalUser();
      };
      const onStorage = (event: StorageEvent) => {
        if (event.key === null || event.key === "boat.local.auth.accounts.v1" || event.key === "boat.local.auth.session.v1") {
          void hydrateLocalUser();
        }
      };
      window.addEventListener(eventName, onLocalAuthChanged);
      window.addEventListener("storage", onStorage);
      return () => {
        window.removeEventListener(eventName, onLocalAuthChanged);
        window.removeEventListener("storage", onStorage);
      };
    }
    let mounted = true;
    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      if (!mounted) return;
      const sessionUser = data.session?.user;
      if (sessionUser) {
        applySessionUser(sessionUser).finally(() => mounted && setLoading(false));
      } else {
        setUser(null);
        setLoading(false);
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      const sessionUser = session?.user;
      if (event === "PASSWORD_RECOVERY") {
        setPendingPasswordReset(true);
        setUser(null);
        return;
      }
      if (sessionUser) {
        setPendingPasswordReset(false);
        applySessionUser(sessionUser);
      } else {
        setUser(null);
      }
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [applySessionUser]);

  useEffect(() => {
    if (IS_LOCAL_AUTH_MODE) return;
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      void refreshUserFlags();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refreshUserFlags]);

  useEffect(() => {
    if (IS_LOCAL_AUTH_MODE) return;
    if (!user?.id) return;
    const timer = window.setInterval(() => {
      void refreshUserFlags();
    }, SUBSCRIPTION_RECHECK_MS);
    return () => window.clearInterval(timer);
  }, [user?.id, refreshUserFlags]);

  const signIn = async (email: string, password: string) => {
    if (IS_LOCAL_AUTH_MODE) {
      const account = readLocalAccounts().find((a) => a.email.toLowerCase() === email.trim().toLowerCase());
      if (!account || account.password !== password) {
        return { error: new Error("Invalid email or password") };
      }
      writeLocalSessionEmail(account.email);
      setUser(toLocalAuthUser(account));
      void ensureLocalSqliteStaffRow(account);
      return { error: null };
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  const signUp = async (
    email: string,
    password: string,
    fullName: string,
    role: UserRole,
    phone = ""
  ) => {
    if (IS_LOCAL_AUTH_MODE) {
      const normalizedEmail = email.trim().toLowerCase();
      const accounts = readLocalAccounts();
      if (accounts.some((a) => a.email.toLowerCase() === normalizedEmail)) {
        return { error: new Error("An account with this email already exists on this computer.") };
      }
      const next: LocalAuthAccount = {
        id: crypto.randomUUID(),
        email: normalizedEmail,
        password,
        full_name: fullName.trim(),
        role,
        phone: phone || "",
        created_at: new Date().toISOString(),
      };
      writeLocalAccounts([...accounts, next]);
      writeLocalSessionEmail(next.email);
      setUser(toLocalAuthUser(next));
      void ensureLocalSqliteStaffRow(next);
      return { error: null };
    }
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, role, phone: phone || "" },
      },
    });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    if (IS_LOCAL_AUTH_MODE) {
      writeLocalSessionEmail(null);
      setUser(null);
      setPendingPasswordReset(false);
      return;
    }
    await supabase.auth.signOut();
    setUser(null);
    setPendingPasswordReset(false);
  };

  const resetPasswordForEmail = async (email: string) => {
    if (IS_LOCAL_AUTH_MODE) {
      void email;
      return { error: new Error("Password reset email is unavailable in desktop local mode.") };
    }
    const redirectTo = `${window.location.origin}${window.location.pathname || "/"}`;
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    return { error: error as Error | null };
  };

  const setNewPassword = async (newPassword: string) => {
    if (IS_LOCAL_AUTH_MODE) {
      void newPassword;
      return { error: new Error("Set password via local sign up/sign in in desktop local mode.") };
    }
    if (newPassword.length < 6) {
      return { error: new Error("Password must be at least 6 characters") as Error };
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { error: error as Error };
    setPendingPasswordReset(false);
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) {
      await applySessionUser(data.session.user);
    }
    return { error: null };
  };

  const isSuperAdmin = !!user?.isSuperAdmin;
  const isHotelStaff = !!user?.isHotelStaff;

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isSuperAdmin,
        isHotelStaff,
        pendingPasswordReset,
        refreshUserFlags,
        signIn,
        signUp,
        signOut,
        resetPasswordForEmail,
        setNewPassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
};
