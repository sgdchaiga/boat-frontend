import { supabase } from "./supabase";

export const PERMISSION_KEYS = [
  "purchase_orders",
  "bills",
  "vendor_credits",
  "chart_of_accounts",
  "sacco_savings_settings",
  "payroll_prepare",
  "payroll_approve",
  "payroll_post",
  "pos_orders_edit",
  "cash_receipts_edit",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export type PermissionDef = {
  key: PermissionKey;
  label: string;
  group: "Approvals" | "Payroll" | "Sales Operations";
  description: string;
};

export const PERMISSIONS: PermissionDef[] = [
  { key: "purchase_orders", label: "Purchase Orders", group: "Approvals", description: "Approve purchase orders." },
  { key: "bills", label: "GRN/Bills", group: "Approvals", description: "Approve supplier bills/GRNs." },
  { key: "vendor_credits", label: "Return to supplier", group: "Approvals", description: "Create and approve vendor credits/returns." },
  { key: "chart_of_accounts", label: "Chart of Accounts", group: "Approvals", description: "Manage GL accounts." },
  { key: "sacco_savings_settings", label: "Savings settings", group: "Approvals", description: "Edit SACCO savings settings." },
  { key: "payroll_prepare", label: "Payroll prepare", group: "Payroll", description: "Prepare and calculate payroll." },
  { key: "payroll_approve", label: "Payroll approve", group: "Payroll", description: "Approve payroll for payment." },
  { key: "payroll_post", label: "Payroll post", group: "Payroll", description: "Post payroll journals to ledger." },
  { key: "pos_orders_edit", label: "Edit POS orders", group: "Sales Operations", description: "Edit/reverse POS orders." },
  { key: "cash_receipts_edit", label: "Edit cash receipts", group: "Sales Operations", description: "Edit/reverse cash receipts." },
];

const CACHE_KEY = "boat.permissions.snapshot.v1";

type PermissionSnapshot = {
  orgId: string;
  staffId: string;
  role: string;
  grants: Record<string, boolean>;
  loadedAt: number;
};

function readSnapshot(): PermissionSnapshot | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PermissionSnapshot;
  } catch {
    return null;
  }
}

function writeSnapshot(snapshot: PermissionSnapshot): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // ignore
  }
}

export async function loadPermissionSnapshot(input: {
  organizationId?: string | null;
  staffId?: string | null;
  role?: string | null;
  isSuperAdmin?: boolean;
}): Promise<Record<string, boolean>> {
  const orgId = input.organizationId ?? null;
  const staffId = input.staffId ?? null;
  const role = (input.role || "").toLowerCase();
  if (!orgId || !staffId) return {};
  if (input.isSuperAdmin) {
    const grants = Object.fromEntries(PERMISSION_KEYS.map((k) => [k, true]));
    writeSnapshot({ orgId, staffId, role, grants, loadedAt: Date.now() });
    return grants;
  }

  const [{ data: roleRows, error: roleErr }, { data: overrideRows, error: overrideErr }] = await Promise.all([
    supabase
      .from("organization_permissions")
      .select("permission_key, allowed")
      .eq("organization_id", orgId)
      .eq("role_key", role),
    supabase
      .from("staff_permission_overrides")
      .select("permission_key, allowed")
      .eq("organization_id", orgId)
      .eq("staff_id", staffId),
  ]);
  if (roleErr) throw roleErr;
  if (overrideErr) throw overrideErr;

  const grants: Record<string, boolean> = {};
  for (const key of PERMISSION_KEYS) grants[key] = false;
  for (const row of roleRows || []) grants[String(row.permission_key)] = !!row.allowed;
  for (const row of overrideRows || []) grants[String(row.permission_key)] = !!row.allowed;

  writeSnapshot({ orgId, staffId, role, grants, loadedAt: Date.now() });
  return grants;
}

export function canApprove(permission: PermissionKey, role?: string | null): boolean {
  const rl = String(role || "").toLowerCase();
  const snapshot = readSnapshot();
  if (snapshot?.grants && Object.prototype.hasOwnProperty.call(snapshot.grants, permission)) {
    return !!snapshot.grants[permission];
  }
  // Fallback defaults (for first load/offline)
  if (permission === "purchase_orders") return rl === "admin" || rl === "manager";
  if (permission === "bills") return rl === "admin" || rl === "manager" || rl === "accountant";
  if (permission === "vendor_credits") return rl === "admin" || rl === "manager";
  if (permission === "chart_of_accounts") return rl === "admin" || rl === "manager";
  if (permission === "sacco_savings_settings") return rl === "admin" || rl === "manager";
  if (permission === "payroll_prepare") return rl === "admin" || rl === "manager" || rl === "accountant";
  if (permission === "payroll_approve") return rl === "admin" || rl === "manager";
  if (permission === "payroll_post") return rl === "admin" || rl === "accountant";
  if (permission === "pos_orders_edit" || permission === "cash_receipts_edit") {
    return rl === "admin" || rl === "manager" || rl === "accountant" || rl === "supervisor";
  }
  return false;
}

