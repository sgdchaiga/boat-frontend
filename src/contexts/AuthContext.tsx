import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

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
  /** School tenants: platform toggles for BOAT-linked areas. */
  school_enable_reports?: boolean;
  school_enable_fixed_deposit?: boolean;
  school_enable_accounting?: boolean;
  school_enable_inventory?: boolean;
  school_enable_purchases?: boolean;
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

async function loadTenantProfile(userId: string): Promise<{
  organization_id: string | null;
  business_type: BusinessType | null;
  subscription_status: SubscriptionStatus;
  subscription_plan_id: string | null;
  subscription_plan_code: string | null;
  subscription_period_end: string | null;
  enable_fixed_assets: boolean;
  school_enable_reports: boolean;
  school_enable_fixed_deposit: boolean;
  school_enable_accounting: boolean;
  school_enable_inventory: boolean;
  school_enable_purchases: boolean;
}> {
  const empty = {
    organization_id: null,
    business_type: null,
    subscription_status: "none" as SubscriptionStatus,
    subscription_plan_id: null,
    subscription_plan_code: null,
    subscription_period_end: null,
    enable_fixed_assets: false,
    school_enable_reports: false,
    school_enable_fixed_deposit: false,
    school_enable_accounting: false,
    school_enable_inventory: false,
    school_enable_purchases: false,
  };

  const { data: staffRow } = await supabase
    .from("staff")
    .select("organization_id")
    .eq("id", userId)
    .maybeSingle();
  const organization_id = (staffRow as { organization_id?: string | null } | null)?.organization_id ?? null;
  if (!organization_id) return empty;

  const [{ data: orgRow }, { data: subRows }] = await Promise.all([
    supabase
      .from("organizations")
      .select(
        "business_type, enable_fixed_assets, school_enable_reports, school_enable_fixed_deposit, school_enable_accounting, school_enable_inventory, school_enable_purchases"
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
    enable_fixed_assets?: boolean | null;
    school_enable_reports?: boolean | null;
    school_enable_fixed_deposit?: boolean | null;
    school_enable_accounting?: boolean | null;
    school_enable_inventory?: boolean | null;
    school_enable_purchases?: boolean | null;
  } | null;

  return {
    organization_id,
    business_type: (org?.business_type ?? null) as BusinessType | null,
    subscription_status: (sub?.status as SubscriptionStatus | undefined) ?? "none",
    subscription_plan_id: sub?.plan_id ?? null,
    subscription_plan_code: sub?.subscription_plans?.code ?? null,
    subscription_period_end: sub?.period_end ?? null,
    enable_fixed_assets: !!org?.enable_fixed_assets,
    school_enable_reports: !!org?.school_enable_reports,
    school_enable_fixed_deposit: !!org?.school_enable_fixed_deposit,
    school_enable_accounting: !!org?.school_enable_accounting,
    school_enable_inventory: !!org?.school_enable_inventory,
    school_enable_purchases: !!org?.school_enable_purchases,
  };
}

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingPasswordReset, setPendingPasswordReset] = useState(false);

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
    setUser({
      id: sessionUser.id,
      email: sessionUser.email,
      role: meta.user_metadata?.role as UserRole | undefined,
      full_name: meta.user_metadata?.full_name as string | undefined,
      phone: meta.user_metadata?.phone as string | undefined,
      ...flags,
      ...tenant,
    });
  }, []);

  const refreshUserFlags = useCallback(async () => {
    if (!user?.id) return;
    const [flags, tenant] = await Promise.all([
      loadUserFlags(user.id),
      loadTenantProfile(user.id),
    ]);
    setUser((u) => (u ? { ...u, ...flags, ...tenant } : null));
  }, [user?.id]);

  useEffect(() => {
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
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      void refreshUserFlags();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refreshUserFlags]);

  const signIn = async (email: string, password: string) => {
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
    await supabase.auth.signOut();
    setUser(null);
    setPendingPasswordReset(false);
  };

  const resetPasswordForEmail = async (email: string) => {
    const redirectTo = `${window.location.origin}${window.location.pathname || "/"}`;
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    return { error: error as Error | null };
  };

  const setNewPassword = async (newPassword: string) => {
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
