import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { desktopApi } from "@/lib/desktopApi";
import {
  readLocalAccounts,
  writeLocalAccounts,
  readLocalSessionEmail,
  writeLocalSessionEmail,
  localAuthChangedEventName,
  clearPinFailures,
  closeActiveAccessSession,
  isPinChangeDue,
  lockActiveAccessSession,
  normalizePin,
  normalizeStaffCode,
  readActiveAccessSession,
  recordPinFailure,
  startLocalAccessSession,
  unlockActiveAccessSession,
  validatePin,
  generateStaffCode,
  type LocalAuthAccount,
  type LocalAccessSession,
} from "@/lib/localAuthStore";
import { readLocalSubscriptionProfile } from "@/lib/localSubscriptionLicense";
import { getTenantIdFromEnv } from "@/lib/deployment";
import {
  loadMembershipsForUser,
  pickDefaultOrganizationId,
  readStoredActiveOrganizationId,
  writeStoredActiveOrganizationId,
  type OrganizationMembership,
} from "@/lib/orgMembership";

export type { OrganizationMembership };

export type UserRole =
  | "super_admin"
  | "admin"
  | "manager"
  | "receptionist"
  | "accountant"
  | "housekeeping"
  | "barman"
  | "cashier"
  | "storekeeper";

export type BusinessType =
  | "hotel"
  | "retail"
  | "mixed"
  | "restaurant"
  | "clinic"
  | "sacco"
  | "school"
  | "manufacturing"
  | "agriculture"
  | "accounting_practice"
  | "vsla"
  | "other";
export type SubscriptionStatus = "trial" | "active" | "past_due" | "cancelled" | "expired" | "none";

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "Super Admin",
  admin: "Administrator",
  manager: "Manager",
  receptionist: "Receptionist",
  accountant: "Accountant",
  housekeeping: "Housekeeping",
  barman: "Barman",
  cashier: "Cashier",
  storekeeper: "Storekeeper",
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
  /** Member-app identity; deliberately separate from staff/organization membership. */
  isSaccoMember?: boolean;
  sacco_member_id?: string | null;
  sacco_member_access_status?: "invited" | "active" | "suspended" | "revoked";
  sacco_member_must_change_password?: boolean;
  organization_name?: string | null;
  /** When set, hospitality POS/orders/payments are limited to this branch (see hospitality_branches). */
  hospitality_branch_id?: string | null;
  business_type?: BusinessType | null;
  subscription_status?: SubscriptionStatus;
  subscription_plan_id?: string | null;
  subscription_plan_code?: string | null;
  subscription_period_end?: string | null;
  /** Platform enables per organization; gates Fixed assets navigation. */
  enable_fixed_assets?: boolean;
  /** Always available to accounting practices; platform-controlled for other organizations. */
  enable_asset_verification?: boolean;
  /** Platform: Communications hub (SMS/WhatsApp). */
  enable_communications?: boolean;
  /** Platform: Wallet module. */
  enable_wallet?: boolean;
  /** Platform: Payroll module toggle. */
  enable_payroll?: boolean;
  /** Platform: Budget module toggle. */
  enable_budget?: boolean;
  /** Platform: Treasury module toggle. */
  enable_treasury?: boolean;
  enable_reconciliation?: boolean;
  /** Platform: Agent Hub module toggle. */
  enable_agent?: boolean;
  /** Platform: BOAT Connect data integration and reporting layer toggle. */
  enable_boat_connect?: boolean;
  /** Platform: Assessment & onboarding module (prospect hotels). */
  enable_hotel_assessment?: boolean;
  /** Platform: Manufacturing module (BOM, work orders, costing). */
  enable_manufacturing?: boolean;
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
  /** When false, PO can be converted to GRN/bill without a separate PO approval step. */
  purchases_require_po_approval?: boolean;
  /** When false, GRN/bill from PO is finalized on convert (no second approval). Manual bills unchanged. */
  purchases_require_bill_approval?: boolean;
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
  accessSession: LocalAccessSession | null;
  terminalLocked: boolean;
  pinChangeRequired: boolean;
  refreshUserFlags: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signInWithPin: (staffCode: string, pin: string) => Promise<{ error: Error | null }>;
  signInMemberWithPin: (phone: string, pin: string) => Promise<{ error: Error | null }>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
    role: UserRole,
    phone?: string
  ) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  switchUser: () => Promise<void>;
  clockOut: () => Promise<void>;
  lockTerminal: (reason?: string) => void;
  unlockWithPin: (pin: string) => Promise<{ error: Error | null }>;
  changePin: (currentPin: string, newPin: string) => Promise<{ error: Error | null }>;
  approveWithSupervisorPin: (pin: string) => Promise<{ error: Error | null; supervisor?: AuthUser }>;
  /** Send password reset email */
  resetPasswordForEmail: (email: string) => Promise<{ error: Error | null }>;
  /** Set new password after recovery link; then completes login */
  setNewPassword: (newPassword: string) => Promise<{ error: Error | null }>;
  completeMemberInitialPassword: (newPassword: string) => Promise<{ error: Error | null }>;
  /** Organizations this login can access (cloud multi-org). */
  memberships: OrganizationMembership[];
  /** True when signed in but must pick an organization before entering the app. */
  needsOrganizationPicker: boolean;
  /** Switch active organization (cloud); reloads tenant profile and syncs server session. */
  switchOrganization: (organizationId: string) => Promise<{ error: Error | null }>;
  /** Same as switchOrganization; used on the post-login picker. */
  selectOrganization: (organizationId: string) => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SUBSCRIPTION_CACHE_KEY_PREFIX = "boat.subscription.cache.v1";
const SUBSCRIPTION_GRACE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const SUBSCRIPTION_RECHECK_MS = 6 * 60 * 60 * 1000; // 6 hours
const LOCAL_AUTH_ENABLED = (import.meta.env.VITE_LOCAL_AUTH || "").trim().toLowerCase();
const IS_LOCAL_AUTH_MODE =
  LOCAL_AUTH_ENABLED === "true" || LOCAL_AUTH_ENABLED === "1" || LOCAL_AUTH_ENABLED === "yes";
const LOCAL_BUSINESS_TYPE = (import.meta.env.VITE_LOCAL_BUSINESS_TYPE || "").trim().toLowerCase();
const DEFAULT_LOCAL_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000001";

/** Same resolution as `getTenantIdFromEnv()` (VITE_TENANT_ID → VITE_LOCAL_ORGANIZATION_ID → storage override). */
function resolvedLocalAuthOrganizationId(): string {
  return getTenantIdFromEnv()?.trim() || DEFAULT_LOCAL_ORGANIZATION_ID;
}
const LOCAL_SUPERADMIN_EMAILS = (import.meta.env.VITE_LOCAL_SUPERADMIN_EMAILS || "")
  .split(",")
  .map((v) => v.trim().toLowerCase())
  .filter(Boolean);

function passwordResetRedirectUrl(): string {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  url.searchParams.set("auth_action", "password_reset");
  return url.toString();
}

function isPasswordResetRedirect(): boolean {
  if (typeof window === "undefined") return false;
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return (
    search.get("auth_action") === "password_reset" ||
    search.get("type") === "recovery" ||
    hash.get("type") === "recovery"
  );
}

function clearPasswordResetUrl(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("auth_action");
  url.searchParams.delete("code");
  url.searchParams.delete("type");
  url.searchParams.delete("token_hash");
  url.hash = "";
  window.history.replaceState(window.history.state, document.title, url.toString());
}

function parseLocalBusinessType(value: string): BusinessType {
  const allowed: BusinessType[] = [
    "hotel",
    "retail",
    "mixed",
    "restaurant",
    "clinic",
    "sacco",
    "school",
    "manufacturing",
    "agriculture",
    "vsla",
    "other",
  ];
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
  enable_asset_verification: boolean;
  enable_communications: boolean;
  enable_wallet: boolean;
  enable_payroll: boolean;
  enable_budget: boolean;
  enable_treasury: boolean;
  enable_reconciliation: boolean;
  enable_agent: boolean;
  enable_boat_connect: boolean;
  enable_hotel_assessment: boolean;
  enable_manufacturing: boolean;
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
  purchases_require_po_approval: boolean;
  purchases_require_bill_approval: boolean;
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
  const organizationId = resolvedLocalAuthOrganizationId();
  const localSubscription = readLocalSubscriptionProfile(organizationId);
  return {
    organization_id: organizationId,
    business_type: businessType,
    subscription_status: localSubscription?.status ?? "active",
    subscription_plan_id: "local-plan",
    subscription_plan_code: localSubscription?.plan_code ?? "desktop-local",
    subscription_period_end: localSubscription?.period_end ?? null,
    enable_fixed_assets: parseLocalBool(import.meta.env.VITE_LOCAL_ENABLE_FIXED_ASSETS, true),
    enable_asset_verification:
      businessType === "accounting_practice" || parseLocalBool(import.meta.env.VITE_LOCAL_ENABLE_ASSET_VERIFICATION, false),
    enable_communications: parseLocalBool(import.meta.env.VITE_LOCAL_ENABLE_COMMUNICATIONS, true),
    enable_wallet: parseLocalBool(import.meta.env.VITE_LOCAL_ENABLE_WALLET, true),
    enable_payroll: parseLocalBool(import.meta.env.VITE_LOCAL_ENABLE_PAYROLL, true),
    enable_budget: parseLocalBool(import.meta.env.VITE_LOCAL_ENABLE_BUDGET, true),
    enable_treasury: parseLocalBool(import.meta.env.VITE_LOCAL_ENABLE_TREASURY, true),
    enable_reconciliation: parseLocalBool(import.meta.env.VITE_LOCAL_ENABLE_RECONCILIATION, true),
    enable_agent: parseLocalBool(import.meta.env.VITE_LOCAL_ENABLE_AGENT, true),
    enable_boat_connect: parseLocalBool(import.meta.env.VITE_LOCAL_ENABLE_BOAT_CONNECT, true),
    enable_hotel_assessment: parseLocalBool(import.meta.env.VITE_LOCAL_ENABLE_HOTEL_ASSESSMENT, true),
    enable_manufacturing: parseLocalBool(import.meta.env.VITE_LOCAL_ENABLE_MANUFACTURING, true),
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
    purchases_require_po_approval: parseLocalBool(import.meta.env.VITE_LOCAL_PURCHASES_REQUIRE_PO_APPROVAL, true),
    purchases_require_bill_approval: parseLocalBool(import.meta.env.VITE_LOCAL_PURCHASES_REQUIRE_BILL_APPROVAL, true),
    license_device_allowed: true,
    license_device_reason: null,
  };
}

async function ensureLocalSqliteStaffRow(account: LocalAuthAccount) {
  if (!IS_LOCAL_AUTH_MODE || !desktopApi.isAvailable()) return;
  try {
    const orgId = resolvedLocalAuthOrganizationId();
    const { data: existing } = await supabase
      .from("staff")
      .select("id,organization_id")
      .eq("id", account.id)
      .maybeSingle();
    if (existing && (existing as { id?: string }).id) {
      const cur = (existing as { organization_id?: string | null }).organization_id;
      if ((cur || "").trim().toLowerCase() !== orgId.toLowerCase()) {
        const { error } = await supabase.from("staff").update({ organization_id: orgId }).eq("id", account.id);
        if (error) console.warn("[BOAT] Local staff org sync failed:", error);
      }
      return;
    }
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
    hospitality_branch_id: account.hospitality_branch_id ?? null,
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
  const [adminRes, staffRes, memberRes] = await Promise.all([
    supabase.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle(),
    supabase.from("staff").select("id").eq("id", userId).maybeSingle(),
    supabase.from("organization_members").select("user_id").eq("user_id", userId).eq("is_active", true).limit(1),
  ]);
  return {
    isSuperAdmin: !!adminRes.data,
    isHotelStaff: !!staffRes.data || ((memberRes.data || []) as { user_id: string }[]).length > 0,
  };
}

async function loadTenantProfile(userId: string, explicitOrganizationId?: string | null): Promise<TenantProfile> {
  const empty = {
    organization_id: null,
    business_type: null,
    subscription_status: "none" as SubscriptionStatus,
    subscription_plan_id: null,
    subscription_plan_code: null,
    subscription_period_end: null,
    enable_fixed_assets: false,
    enable_asset_verification: false,
    enable_communications: true,
    enable_wallet: true,
    enable_payroll: true,
    enable_budget: true,
    enable_treasury: true,
    enable_reconciliation: true,
    enable_agent: true,
    enable_boat_connect: true,
    enable_hotel_assessment: true,
    enable_manufacturing: true,
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
    purchases_require_po_approval: true,
    purchases_require_bill_approval: true,
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
    const staffOrgId = (staffRow as { organization_id?: string | null } | null)?.organization_id ?? null;
    /** Desktop local: `.env` org (VITE_TENANT_ID / VITE_LOCAL_ORGANIZATION_ID) must win over stale SQLite `staff.organization_id` (often the dev default UUID). */
    const envOrgId = getTenantIdFromEnv()?.trim() || null;
    const organization_id =
      IS_LOCAL_AUTH_MODE && envOrgId
        ? envOrgId
        : explicitOrganizationId ?? staffOrgId;
    if (!organization_id) {
      writeTenantCache(userId, empty);
      return empty;
    }

    const [{ data: orgRow, error: orgError }, { data: subRows, error: subError }] = await Promise.all([
      supabase
        .from("organizations")
        .select(
          "business_type, desktop_device_limit, enable_fixed_assets, enable_asset_verification, enable_communications, enable_wallet, enable_payroll, enable_budget, enable_treasury, enable_reconciliation, enable_agent, enable_boat_connect, enable_hotel_assessment, enable_manufacturing, enable_reports, enable_accounting, enable_inventory, enable_purchases, hotel_enable_smart_room_charges, school_enable_reports, school_enable_fixed_deposit, school_enable_accounting, school_enable_inventory, school_enable_purchases, purchases_require_po_approval, purchases_require_bill_approval"
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
      enable_asset_verification?: boolean | null;
      enable_communications?: boolean | null;
      enable_wallet?: boolean | null;
      enable_payroll?: boolean | null;
      enable_budget?: boolean | null;
      enable_treasury?: boolean | null;
      enable_reconciliation?: boolean | null;
      enable_agent?: boolean | null;
      enable_boat_connect?: boolean | null;
      enable_hotel_assessment?: boolean | null;
      enable_manufacturing?: boolean | null;
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
      purchases_require_po_approval?: boolean | null;
      purchases_require_bill_approval?: boolean | null;
    } | null;

    const deviceLimit = Math.max(1, Number(org?.desktop_device_limit ?? 1));
    const seatCheck = await enforceDesktopSeatLimit(organization_id, deviceLimit);
    const rawSubStatus = sub?.status as SubscriptionStatus | undefined;
    /** Local desktop SQLite often has no `organization_subscriptions` row — `none` would make Admin/staff read-only. */
    const effectiveSubscriptionStatus: SubscriptionStatus = !seatCheck.allowed
      ? "expired"
      : IS_LOCAL_AUTH_MODE
        ? rawSubStatus === "active" || rawSubStatus === "trial"
          ? rawSubStatus
          : "active"
        : rawSubStatus ?? "none";

    const resolved: TenantProfile = {
      organization_id,
      business_type: (org?.business_type ?? null) as BusinessType | null,
      subscription_status: effectiveSubscriptionStatus,
      subscription_plan_id: sub?.plan_id ?? null,
      subscription_plan_code: sub?.subscription_plans?.code ?? null,
      subscription_period_end: sub?.period_end ?? null,
      enable_fixed_assets: !!org?.enable_fixed_assets,
      enable_asset_verification:
        org?.business_type === "accounting_practice" || org?.enable_asset_verification === true,
      enable_communications: org?.enable_communications !== false,
      enable_wallet: org?.enable_wallet !== false,
      enable_payroll: org?.enable_payroll !== false,
      enable_budget: org?.enable_budget !== false,
      enable_treasury: org?.enable_treasury !== false,
      enable_reconciliation: org?.enable_reconciliation !== false,
      enable_agent: org?.enable_agent !== false,
      enable_boat_connect: org?.enable_boat_connect !== false,
      enable_hotel_assessment: org?.enable_hotel_assessment !== false,
      enable_manufacturing: org?.enable_manufacturing !== false,
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
      purchases_require_po_approval: org?.purchases_require_po_approval !== false,
      purchases_require_bill_approval: org?.purchases_require_bill_approval !== false,
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

function subscriptionMetaForUserId(userId: string) {
  const cached = readTenantCache(userId);
  if (!cached) {
    return {
      subscription_last_validated_at: null as number | null,
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
}

/** Desktop local auth: merge SQLite org/subscription flags (e.g. purchase approvals) over env defaults. */
async function buildLocalAuthUserWithTenant(account: LocalAuthAccount): Promise<AuthUser> {
  const base = toLocalAuthUser(account);
  if (!desktopApi.isAvailable()) {
    return { ...base, ...subscriptionMetaForUserId(account.id) };
  }
  try {
    const tenant = await loadTenantProfile(account.id);
    if (tenant.organization_id) {
      return {
        ...base,
        ...tenant,
        business_type: (tenant.business_type ?? base.business_type) as TenantProfile["business_type"],
        ...subscriptionMetaForUserId(account.id),
      };
    }
  } catch {
    /* keep base */
  }
  return { ...base, ...subscriptionMetaForUserId(account.id) };
}

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingPasswordReset, setPendingPasswordReset] = useState(false);
  const passwordResetModeRef = useRef(false);
  const [accessSession, setAccessSession] = useState<LocalAccessSession | null>(null);
  const [terminalLocked, setTerminalLocked] = useState(false);
  const [pinChangeRequired, setPinChangeRequired] = useState(false);
  const [memberships, setMemberships] = useState<OrganizationMembership[]>([]);
  const [needsOrganizationPicker, setNeedsOrganizationPicker] = useState(false);

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

  const buildAuthUser = useCallback(
    (
      sessionUser: { id: string; email: string },
      flags: { isSuperAdmin: boolean; isHotelStaff: boolean },
      tenant: TenantProfile,
      membership?: OrganizationMembership | null,
      meta?: Record<string, unknown>
    ): AuthUser => {
      const subscriptionCacheMeta = getSubscriptionCacheMeta(sessionUser.id);
      const roleFromMember = membership?.role as UserRole | undefined;
      return {
        id: sessionUser.id,
        email: sessionUser.email,
        role: roleFromMember ?? (meta?.role as UserRole | undefined),
        full_name: membership?.full_name ?? (meta?.full_name as string | undefined),
        phone: membership?.phone ?? (meta?.phone as string | undefined),
        hospitality_branch_id:
          (meta?.hospitality_branch_id as string | null | undefined) ?? null,
        ...flags,
        ...tenant,
        ...subscriptionCacheMeta,
      };
    },
    [getSubscriptionCacheMeta]
  );

  const activateCloudOrganization = useCallback(
    async (
      sessionUser: { id: string; email: string },
      organizationId: string,
      memberList: OrganizationMembership[],
      meta?: Record<string, unknown>
    ) => {
      const { error: rpcError } = await supabase.rpc("set_active_organization", {
        p_organization_id: organizationId,
      });
      if (rpcError) throw rpcError;

      writeStoredActiveOrganizationId(sessionUser.id, organizationId);
      const membership = memberList.find((m) => m.organization_id === organizationId) ?? null;
      const [flags, tenant, refreshedMembers, staffBranchRes] = await Promise.all([
        loadUserFlags(sessionUser.id),
        loadTenantProfile(sessionUser.id, organizationId),
        loadMembershipsForUser(sessionUser.id).catch(() => memberList),
        supabase.from("staff").select("hospitality_branch_id").eq("id", sessionUser.id).maybeSingle(),
      ]);
      const branchMeta = {
        ...meta,
        hospitality_branch_id:
          (staffBranchRes.data as { hospitality_branch_id?: string | null } | null)?.hospitality_branch_id ??
          null,
      };
      setMemberships(refreshedMembers);
      setNeedsOrganizationPicker(false);
      setUser(buildAuthUser(sessionUser, flags, tenant, membership, branchMeta));
    },
    [buildAuthUser]
  );

  const applySessionUser = useCallback(
    async (sessionUser: { id: string; email?: string } | null) => {
      if (!sessionUser?.email) {
        setUser(null);
        setMemberships([]);
        setNeedsOrganizationPicker(false);
        return;
      }

      const meta = (sessionUser as { user_metadata?: Record<string, unknown> }).user_metadata;
      const flags = await loadUserFlags(sessionUser.id);

      const { data: memberAccess } = await supabase
        .from("sacco_member_app_users")
        .select("organization_id,sacco_member_id,status,must_change_password,sacco_members(full_name,phone)")
        .eq("auth_user_id", sessionUser.id)
        .maybeSingle();
      const appAccess = memberAccess as {
        organization_id?: string;
        sacco_member_id?: string;
        status?: string;
        must_change_password?: boolean;
        sacco_members?: { full_name?: string | null; phone?: string | null } | null;
      } | null;
      if (appAccess?.sacco_member_id) {
        const tenant = await loadTenantProfile(sessionUser.id, appAccess.organization_id);
        setMemberships([]);
        setNeedsOrganizationPicker(false);
        setUser({
          ...buildAuthUser({ id: sessionUser.id, email: sessionUser.email }, flags, tenant, null, meta),
          organization_id: appAccess.organization_id,
          business_type: "sacco",
          role: undefined,
          full_name: appAccess.sacco_members?.full_name ?? (meta?.full_name as string | undefined),
          phone: appAccess.sacco_members?.phone ?? (meta?.phone as string | undefined),
          isSaccoMember: true,
          sacco_member_id: appAccess.sacco_member_id,
          sacco_member_access_status: appAccess.status as AuthUser["sacco_member_access_status"],
          sacco_member_must_change_password: appAccess.must_change_password !== false,
          isHotelStaff: false,
        });
        if (["invited", "active"].includes(appAccess.status || "")) void supabase.rpc("mark_sacco_member_app_login");
        return;
      }

      if (IS_LOCAL_AUTH_MODE) {
        const [tenant] = await Promise.all([loadTenantProfile(sessionUser.id)]);
        setMemberships([]);
        setNeedsOrganizationPicker(false);
        setUser(buildAuthUser({ id: sessionUser.id, email: sessionUser.email }, flags, tenant, null, meta));
        return;
      }

      let memberList: OrganizationMembership[] = [];
      if (!flags.isSuperAdmin) {
        try {
          memberList = await loadMembershipsForUser(sessionUser.id);
        } catch {
          memberList = [];
        }
      }
      setMemberships(memberList);

      if (flags.isSuperAdmin && memberList.length === 0) {
        const tenant = await loadTenantProfile(sessionUser.id);
        setNeedsOrganizationPicker(false);
        setUser(buildAuthUser({ id: sessionUser.id, email: sessionUser.email }, flags, tenant, null, meta));
        return;
      }

      if (memberList.length === 0) {
        const tenant = await loadTenantProfile(sessionUser.id);
        setNeedsOrganizationPicker(false);
        setUser(buildAuthUser({ id: sessionUser.id, email: sessionUser.email }, flags, tenant, null, meta));
        return;
      }

      const storedOrgId = readStoredActiveOrganizationId(sessionUser.id);
      const activeOrgId =
        storedOrgId && memberList.some((m) => m.organization_id === storedOrgId)
          ? storedOrgId
          : memberList.length === 1
            ? memberList[0].organization_id
            : pickDefaultOrganizationId(memberList, null);

      if (memberList.length > 1 && !storedOrgId) {
        setNeedsOrganizationPicker(true);
        setUser({
          id: sessionUser.id,
          email: sessionUser.email,
          ...flags,
          organization_id: null,
          business_type: null,
          subscription_status: "none",
          subscription_plan_id: null,
          subscription_plan_code: null,
          subscription_period_end: null,
          enable_fixed_assets: false,
          enable_asset_verification: false,
          enable_communications: true,
          enable_wallet: true,
          enable_payroll: true,
          enable_budget: true,
          enable_treasury: true,
          enable_reconciliation: true,
          enable_agent: true,
          enable_boat_connect: true,
          enable_hotel_assessment: true,
          enable_manufacturing: true,
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
          purchases_require_po_approval: true,
          purchases_require_bill_approval: true,
          license_device_allowed: true,
          license_device_reason: null,
          ...getSubscriptionCacheMeta(sessionUser.id),
        });
        return;
      }

      if (!activeOrgId) {
        setNeedsOrganizationPicker(memberList.length > 1);
        return;
      }

      try {
        await activateCloudOrganization(
          { id: sessionUser.id, email: sessionUser.email },
          activeOrgId,
          memberList,
          meta
        );
      } catch (err) {
        console.error("Failed to activate organization", err);
        if (memberList.length > 1) {
          setNeedsOrganizationPicker(true);
        }
        const tenant = await loadTenantProfile(sessionUser.id);
        setUser(buildAuthUser({ id: sessionUser.id, email: sessionUser.email }, flags, tenant, null, meta));
      }
    },
    [activateCloudOrganization, buildAuthUser, getSubscriptionCacheMeta]
  );

  const switchOrganization = useCallback(
    async (organizationId: string) => {
      if (IS_LOCAL_AUTH_MODE) {
        return { error: new Error("Organization switching is available in cloud mode only.") };
      }
      if (!user?.id || !user.email) {
        return { error: new Error("Not signed in") };
      }
      const member = memberships.find((m) => m.organization_id === organizationId);
      if (!member) {
        return { error: new Error("You do not have access to that organization.") };
      }
      try {
        await activateCloudOrganization(
          { id: user.id, email: user.email },
          organizationId,
          memberships
        );
        return { error: null };
      } catch (err) {
        return { error: err instanceof Error ? err : new Error("Failed to switch organization") };
      }
    },
    [activateCloudOrganization, memberships, user?.email, user?.id]
  );

  const importBootstrapAdminIfNeeded = useCallback(async (): Promise<LocalAuthAccount[]> => {
    const accounts = readLocalAccounts();
    if (accounts.length > 0 || !desktopApi.isAvailable()) return accounts;
    const seed = await desktopApi.consumeBootstrapAdmin();
    if (!seed?.email || !seed.password) return accounts;
    const email = seed.email.trim().toLowerCase();
    const now = new Date().toISOString();
    const next: LocalAuthAccount = {
      id: crypto.randomUUID(),
      email,
      password: seed.password,
      full_name: seed.full_name?.trim() || "School Administrator",
      role: (seed.role || "admin") as UserRole,
      phone: seed.phone || "",
      staff_code: seed.staff_code || generateStaffCode(seed.full_name || "School Administrator", email, []),
      pin: seed.pin || "1234",
      pin_set_at: now,
      pin_changed_at: now,
      pin_change_required: true,
      created_at: now,
    };
    writeLocalAccounts([next]);
    await ensureLocalSqliteStaffRow(next);
    return [next];
  }, []);

  const refreshUserFlags = useCallback(async () => {
    if (IS_LOCAL_AUTH_MODE) {
      const sessionEmail = readLocalSessionEmail();
      if (!sessionEmail) {
        setUser(null);
        setAccessSession(null);
        setTerminalLocked(false);
        setPinChangeRequired(false);
        return;
      }
      const account = readLocalAccounts().find((a) => a.email.toLowerCase() === sessionEmail.toLowerCase());
      const activeAccess = readActiveAccessSession();
      setAccessSession(activeAccess);
      setTerminalLocked(activeAccess?.status === "locked");
      setPinChangeRequired(!!account && isPinChangeDue(account));
      setUser(account ? await buildLocalAuthUserWithTenant(account) : null);
      return;
    }
    if (!user?.id) return;
    const activeOrgId = user.organization_id ?? readStoredActiveOrganizationId(user.id);
    const [flags, tenant, staffBranchRes] = await Promise.all([
      loadUserFlags(user.id),
      loadTenantProfile(user.id, activeOrgId),
      supabase.from("staff").select("hospitality_branch_id").eq("id", user.id).maybeSingle(),
    ]);
    const subscriptionCacheMeta = getSubscriptionCacheMeta(user.id);
    const membership = memberships.find((m) => m.organization_id === activeOrgId) ?? null;
    const hospitality_branch_id =
      (staffBranchRes.data as { hospitality_branch_id?: string | null } | null)?.hospitality_branch_id ?? null;
    setUser((u) =>
      u
        ? {
            ...u,
            ...flags,
            ...tenant,
            ...subscriptionCacheMeta,
            role: (membership?.role as UserRole | undefined) ?? u.role,
            full_name: membership?.full_name ?? u.full_name,
            phone: membership?.phone ?? u.phone,
            hospitality_branch_id,
          }
        : null
    );
  }, [getSubscriptionCacheMeta, memberships, user?.id, user?.organization_id]);

  useEffect(() => {
    if (IS_LOCAL_AUTH_MODE) {
      const hydrateLocalUser = async () => {
        const sessionEmail = readLocalSessionEmail();
        const accounts = await importBootstrapAdminIfNeeded();
        const account = accounts.find((a) => a.email.toLowerCase() === (sessionEmail || "").toLowerCase());
        let effectiveAccount = account ?? null;
        if (account?.id) {
          try {
            const { data: staffRow } = await supabase
              .from("staff")
              .select("full_name,phone,role,hospitality_branch_id")
              .eq("id", account.id)
              .maybeSingle();
            const row =
              (staffRow as {
                full_name?: string | null;
                phone?: string | null;
                role?: string | null;
                hospitality_branch_id?: string | null;
              } | null) ?? null;
            if (row) {
              effectiveAccount = {
                ...account,
                full_name: row.full_name ?? account.full_name,
                phone: row.phone ?? account.phone,
                role: row.role ?? account.role,
                hospitality_branch_id: row.hospitality_branch_id ?? null,
              };
              const nextAccounts = accounts.map((a) => (a.id === account.id ? effectiveAccount! : a));
              writeLocalAccounts(nextAccounts);
            }
          } catch {
            // keep local account fallback when local DB query fails
          }
        }
        if (effectiveAccount) {
          await ensureLocalSqliteStaffRow(effectiveAccount);
        }
        const activeAccess = readActiveAccessSession();
        setAccessSession(activeAccess);
        setTerminalLocked(activeAccess?.status === "locked");
        setPinChangeRequired(!!effectiveAccount && isPinChangeDue(effectiveAccount));
        setUser(effectiveAccount ? await buildLocalAuthUserWithTenant(effectiveAccount) : null);
        setLoading(false);
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
    const handlingPasswordReset = isPasswordResetRedirect();
    passwordResetModeRef.current = handlingPasswordReset;
    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      if (!mounted) return;
      const sessionUser = data.session?.user;
      if (handlingPasswordReset) {
        setPendingPasswordReset(true);
        setUser(null);
        setLoading(false);
        return;
      }
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
        passwordResetModeRef.current = true;
        setPendingPasswordReset(true);
        setUser(null);
        return;
      }
      if (passwordResetModeRef.current && sessionUser) {
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
  }, [applySessionUser, importBootstrapAdminIfNeeded]);

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
      await ensureLocalSqliteStaffRow(account);
      const session = startLocalAccessSession(account, "password");
      setAccessSession(session);
      setTerminalLocked(false);
      setPinChangeRequired(isPinChangeDue(account));
      setUser(await buildLocalAuthUserWithTenant(account));
      return { error: null };
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  const signInWithPin = async (staffCode: string, pin: string) => {
    const code = normalizeStaffCode(staffCode);
    const enteredPin = normalizePin(pin);
    if (!IS_LOCAL_AUTH_MODE) {
      const { data, error } = await supabase.functions.invoke("staff-pin-login", {
        body: {
          staff_code: code,
          pin: enteredPin,
          redirect_to: `${window.location.origin}${window.location.pathname || "/"}`,
        },
      });
      if (error) {
        let message = error.message || "PIN login service failed.";
        const response = (error as Error & { context?: Response }).context;
        if (response && typeof response.clone === "function") {
          try {
            const payload = await response.clone().json() as { error?: unknown; message?: unknown };
            const detailed = typeof payload.error === "string" ? payload.error : typeof payload.message === "string" ? payload.message : "";
            if (detailed) message = detailed;
          } catch {
            try {
              const text = await response.clone().text();
              if (text.trim()) message = text.trim();
            } catch {
              /* Keep the original Functions client message. */
            }
          }
        }
        return { error: new Error(message) };
      }
      if (!data?.ok) return { error: new Error(data?.error || data?.message || "PIN login failed") };
      if (!data.token_hash) return { error: new Error("PIN login did not return a session token.") };
      const { error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: data.token_hash,
        type: "magiclink",
      });
      if (verifyError) return { error: verifyError as Error };
      return { error: null };
    }
    const account = readLocalAccounts().find((a) => normalizeStaffCode(a.staff_code || "") === code);
    if (!account || !account.pin) {
      return { error: new Error("Invalid staff code or PIN") };
    }
    if (account.pin_locked_until && new Date(account.pin_locked_until).getTime() > Date.now()) {
      return { error: new Error(`PIN locked until ${new Date(account.pin_locked_until).toLocaleTimeString()}.`) };
    }
    if (account.pin !== enteredPin) {
      const failure = recordPinFailure(account.id);
      if (failure.lockedUntil) {
        return { error: new Error(`Too many failed attempts. PIN locked until ${new Date(failure.lockedUntil).toLocaleTimeString()}.`) };
      }
      return { error: new Error(`Invalid staff code or PIN. ${Math.max(0, 5 - failure.attempts)} attempts remaining.`) };
    }
    clearPinFailures(account.id);
    writeLocalSessionEmail(account.email);
    await ensureLocalSqliteStaffRow(account);
    const session = startLocalAccessSession(account, "pin");
    setAccessSession(session);
    setTerminalLocked(false);
    setPinChangeRequired(isPinChangeDue(account));
    setUser(await buildLocalAuthUserWithTenant(account));
    return { error: null };
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
      await ensureLocalSqliteStaffRow(next);
      const session = startLocalAccessSession(next, "password");
      setAccessSession(session);
      setTerminalLocked(false);
      setPinChangeRequired(false);
      setUser(await buildLocalAuthUserWithTenant(next));
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
      closeActiveAccessSession();
      writeLocalSessionEmail(null);
      setUser(null);
      setPendingPasswordReset(false);
      setAccessSession(null);
      setTerminalLocked(false);
      setPinChangeRequired(false);
      return;
    }
    await supabase.auth.signOut();
    setUser(null);
    setMemberships([]);
    setNeedsOrganizationPicker(false);
    setPendingPasswordReset(false);
  };

  const lockTerminal = (reason = "inactivity") => {
    if (!IS_LOCAL_AUTH_MODE || !user) return;
    const next = lockActiveAccessSession(reason);
    setAccessSession(next);
    setTerminalLocked(true);
  };

  const switchUser = async () => {
    if (IS_LOCAL_AUTH_MODE) {
      closeActiveAccessSession();
      writeLocalSessionEmail(null);
      setUser(null);
      setAccessSession(null);
      setTerminalLocked(false);
      setPinChangeRequired(false);
      return;
    }
    await signOut();
  };

  const clockOut = async () => {
    await signOut();
  };

  const unlockWithPin = async (pin: string) => {
    if (!IS_LOCAL_AUTH_MODE || !user?.id) return { error: new Error("No locked local session found.") };
    const account = readLocalAccounts().find((a) => a.id === user.id);
    if (!account?.pin) return { error: new Error("This user does not have a PIN. Switch user and sign in with password.") };
    if (account.pin !== normalizePin(pin)) {
      const failure = recordPinFailure(account.id);
      if (failure.lockedUntil) return { error: new Error(`Too many failed attempts. PIN locked until ${new Date(failure.lockedUntil).toLocaleTimeString()}.`) };
      return { error: new Error("Incorrect PIN.") };
    }
    clearPinFailures(account.id);
    const session = unlockActiveAccessSession();
    setAccessSession(session);
    setTerminalLocked(false);
    setPinChangeRequired(isPinChangeDue(account));
    return { error: null };
  };

  const changePin = async (currentPin: string, newPin: string) => {
    if (!IS_LOCAL_AUTH_MODE || !user?.id) return { error: new Error("PIN changes are available in desktop local mode.") };
    const pinError = validatePin(normalizePin(newPin));
    if (pinError) return { error: new Error(pinError) };
    const accounts = readLocalAccounts();
    const account = accounts.find((a) => a.id === user.id);
    if (!account) return { error: new Error("Local staff account not found.") };
    if (account.pin && account.pin !== normalizePin(currentPin)) return { error: new Error("Current PIN is incorrect.") };
    const changedAt = new Date().toISOString();
    writeLocalAccounts(accounts.map((a) => (a.id === user.id ? {
      ...a,
      pin: normalizePin(newPin),
      pin_set_at: a.pin_set_at ?? changedAt,
      pin_changed_at: changedAt,
      pin_change_required: false,
      pin_failed_attempts: 0,
      pin_locked_until: null,
    } : a)));
    setPinChangeRequired(false);
    return { error: null };
  };

  const approveWithSupervisorPin = async (pin: string) => {
    if (!IS_LOCAL_AUTH_MODE) return { error: new Error("Supervisor PIN approval is available in desktop local mode.") };
    const supervisorRoles = new Set(["admin", "manager", "accountant"]);
    const account = readLocalAccounts().find((a) => a.pin === normalizePin(pin) && supervisorRoles.has(String(a.role || "").toLowerCase()));
    if (!account) return { error: new Error("Supervisor PIN was not approved.") };
    return { error: null, supervisor: await buildLocalAuthUserWithTenant(account) };
  };

  useEffect(() => {
    if (!IS_LOCAL_AUTH_MODE || !user || terminalLocked) return;
    let timer: number | null = null;
    const arm = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => lockTerminal("inactivity"), 10 * 60 * 1000);
    };
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    events.forEach((event) => window.addEventListener(event, arm, { passive: true }));
    arm();
    return () => {
      if (timer) window.clearTimeout(timer);
      events.forEach((event) => window.removeEventListener(event, arm));
    };
  }, [user, terminalLocked]);

  const resetPasswordForEmail = async (email: string) => {
    if (IS_LOCAL_AUTH_MODE) {
      void email;
      return {
        error: new Error(
          "Password reset email is not available in desktop local mode. Ask an administrator to set a temporary password, then change it after signing in."
        ),
      };
    }
    const redirectTo = passwordResetRedirectUrl();
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
    passwordResetModeRef.current = false;
    setPendingPasswordReset(false);
    clearPasswordResetUrl();
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) {
      await applySessionUser(data.session.user);
    }
    return { error: null };
  };

  const signInMemberWithPin = async (phone: string, pin: string) => {
    if (IS_LOCAL_AUTH_MODE) return { error: new Error("Member telephone login requires the online SACCO service.") };
    const normalizedPhone = phone.replace(/\D/g, "");
    const normalizedPin = pin.replace(/\D/g, "");
    if (normalizedPhone.length < 9) return { error: new Error("Enter a valid telephone number.") };
    if (!/^\d{6}$/.test(normalizedPin)) return { error: new Error("Enter your 6-digit member PIN.") };
    const { data, error } = await supabase.functions.invoke("sacco-member-pin-login", {
      body: { phone: normalizedPhone, pin: normalizedPin, redirect_to: `${window.location.origin}${window.location.pathname || "/"}` },
    });
    if (error) {
      let message = error.message || "Member PIN login service failed.";
      const response = (error as Error & { context?: Response }).context;
      if (response && typeof response.clone === "function") {
        try {
          const payload = await response.clone().json() as { error?: unknown; message?: unknown };
          const detail = typeof payload.error === "string" ? payload.error : typeof payload.message === "string" ? payload.message : "";
          if (detail) message = detail;
        } catch {
          try { const detail = await response.clone().text(); if (detail.trim()) message = detail.trim(); } catch { /* keep original */ }
        }
      }
      if (/non-2xx/i.test(message)) message = "Member PIN service is unavailable. Deploy sacco-member-pin-login with JWT verification disabled.";
      return { error: new Error(message) };
    }
    if (!data?.ok || !data.token_hash) return { error: new Error(data?.error || "Invalid telephone or PIN.") };
    const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash: data.token_hash, type: "magiclink" });
    return { error: verifyError as Error | null };
  };

  const completeMemberInitialPassword = async (newPassword: string) => {
    const result = await setNewPassword(newPassword);
    if (result.error) return result;
    const { error } = await supabase.rpc("complete_sacco_member_password_change");
    if (error) return { error: error as Error };
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) await applySessionUser(data.session.user);
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
        accessSession,
        terminalLocked,
        pinChangeRequired,
        refreshUserFlags,
        signIn,
        signInWithPin,
        signInMemberWithPin,
        signUp,
        signOut,
        switchUser,
        clockOut,
        lockTerminal,
        unlockWithPin,
        changePin,
        approveWithSupervisorPin,
        resetPasswordForEmail,
        setNewPassword,
        completeMemberInitialPassword,
        memberships,
        needsOrganizationPicker,
        switchOrganization,
        selectOrganization: switchOrganization,
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
