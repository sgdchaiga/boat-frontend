import { canApprove as canApprovePermission } from "./permissions";

/**
 * Backward-compatible wrapper around unified permissions.
 * New source of truth is Admin > Permissions.
 */

export type ApprovalType =
  | "purchase_orders"
  | "bills"
  | "vendor_credits"
  | "chart_of_accounts"
  | "sacco_savings_settings"
  | "payroll_prepare"
  | "payroll_approve"
  | "payroll_post";

export type StaffRole = "admin" | "manager" | "receptionist" | "accountant" | "housekeeping";

export const ALL_ROLES: StaffRole[] = ["admin", "manager", "receptionist", "accountant", "housekeeping"];

export const ROLE_LABELS: Record<StaffRole, string> = {
  admin: "Admin",
  manager: "Manager",
  receptionist: "Receptionist",
  accountant: "Accountant",
  housekeeping: "Housekeeping",
};

/** Staff roles shown in Admin → Approval Rights for each organization business type. */
export function getRolesForOrganization(
  businessType: string | null | undefined
): string[] {
  const t = String(businessType || "other").toLowerCase();
  if (t === "hotel" || t === "mixed") {
    return [...ALL_ROLES];
  }
  if (t === "retail" || t === "restaurant" || t === "sacco") {
    return ["admin", "manager", "accountant"];
  }
  // other: common operational roles without hotel-only titles
  return ["admin", "manager", "accountant", "receptionist"];
}

/** Drop approval entries for roles not used by this organization (e.g. after type switch or shared localStorage). */
export function filterApprovalConfigToRoles(
  config: ApprovalRightsConfig,
  roles: string[]
): ApprovalRightsConfig {
  const allowed = new Set(roles);
  return {
    purchase_orders: (config.purchase_orders || []).filter((r) => allowed.has(r)),
    bills: (config.bills || []).filter((r) => allowed.has(r)),
    vendor_credits: (config.vendor_credits || []).filter((r) => allowed.has(r)),
    chart_of_accounts: (config.chart_of_accounts || []).filter((r) => allowed.has(r)),
    sacco_savings_settings: (config.sacco_savings_settings || []).filter((r) => allowed.has(r)),
    payroll_prepare: (config.payroll_prepare || []).filter((r) => allowed.has(r)),
    payroll_approve: (config.payroll_approve || []).filter((r) => allowed.has(r)),
    payroll_post: (config.payroll_post || []).filter((r) => allowed.has(r)),
  };
}

export interface ApprovalRightsConfig {
  purchase_orders: string[];
  bills: string[];
  vendor_credits: string[];
  chart_of_accounts: string[];
  /** SACCO: who may edit savings account types & account number format (Members → Savings settings). */
  sacco_savings_settings: string[];
  /** Prepare runs, calculate payslips, edit absences, staff pay, loans, periods. */
  payroll_prepare: string[];
  /** Approve payroll for posting (required before journal post). */
  payroll_approve: string[];
  /** Post payroll journal to the GL. */
  payroll_post: string[];
}

const STORAGE_KEY = "guestpro_approval_rights";

const DEFAULT_CONFIG: ApprovalRightsConfig = {
  purchase_orders: ["admin", "manager"],
  bills: ["admin", "manager", "accountant"],
  vendor_credits: ["admin", "manager"],
  chart_of_accounts: ["admin", "manager"],
  sacco_savings_settings: ["admin", "manager"],
  payroll_prepare: ["admin", "manager", "accountant"],
  payroll_approve: ["admin", "manager"],
  payroll_post: ["admin", "accountant"],
};

export function loadApprovalRights(): ApprovalRightsConfig {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      return {
        purchase_orders: Array.isArray(parsed.purchase_orders) ? parsed.purchase_orders : DEFAULT_CONFIG.purchase_orders,
        bills: Array.isArray(parsed.bills) ? parsed.bills : DEFAULT_CONFIG.bills,
        vendor_credits: Array.isArray(parsed.vendor_credits) ? parsed.vendor_credits : DEFAULT_CONFIG.vendor_credits,
        chart_of_accounts: Array.isArray(parsed.chart_of_accounts) ? parsed.chart_of_accounts : DEFAULT_CONFIG.chart_of_accounts,
        sacco_savings_settings: Array.isArray(parsed.sacco_savings_settings)
          ? parsed.sacco_savings_settings
          : DEFAULT_CONFIG.sacco_savings_settings,
        payroll_prepare: Array.isArray(parsed.payroll_prepare) ? parsed.payroll_prepare : DEFAULT_CONFIG.payroll_prepare,
        payroll_approve: Array.isArray(parsed.payroll_approve) ? parsed.payroll_approve : DEFAULT_CONFIG.payroll_approve,
        payroll_post: Array.isArray(parsed.payroll_post) ? parsed.payroll_post : DEFAULT_CONFIG.payroll_post,
      };
    } catch (_) {}
  }
  return DEFAULT_CONFIG;
}

export function saveApprovalRights(config: ApprovalRightsConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function canApprove(type: ApprovalType, role?: string | null): boolean {
  return canApprovePermission(type, role);
}

/** Label for a role key in UI (fallback when org-defined names are not loaded). */
export function approvalRoleLabel(role: string): string {
  const map = ROLE_LABELS as Record<string, string>;
  return map[role] ?? role;
}
