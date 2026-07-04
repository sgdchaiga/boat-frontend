import { supabase } from "./supabase";

export const PERMISSION_KEYS = [
  "purchase_orders",
  "bills",
  "vendor_credits",
  "chart_of_accounts",
  "sacco_savings_settings",
  "sacco_transaction_edit",
  "payroll_prepare",
  "payroll_approve",
  "payroll_post",
  "pos_orders_edit",
  "cash_receipts_edit",
  "stock_adjustments_delete",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export type PermissionDef = {
  key: PermissionKey;
  label: string;
  group: "Approvals" | "Payroll" | "Sales Operations" | "Inventory";
  description: string;
};

export const PERMISSIONS: PermissionDef[] = [
  { key: "purchase_orders", label: "Purchase Orders", group: "Approvals", description: "Approve purchase orders." },
  { key: "bills", label: "GRN/Bills", group: "Approvals", description: "Approve supplier bills/GRNs." },
  { key: "vendor_credits", label: "Return to supplier", group: "Approvals", description: "Create and approve vendor credits/returns." },
  { key: "chart_of_accounts", label: "Chart of Accounts", group: "Approvals", description: "Manage GL accounts." },
  { key: "sacco_savings_settings", label: "Savings settings", group: "Approvals", description: "Edit SACCO savings settings." },
  { key: "sacco_transaction_edit", label: "Edit SACCO transactions", group: "Approvals", description: "Correct teller transactions (audit trail)." },
  { key: "payroll_prepare", label: "Payroll prepare", group: "Payroll", description: "Prepare and calculate payroll." },
  { key: "payroll_approve", label: "Payroll approve", group: "Payroll", description: "Approve payroll for payment." },
  { key: "payroll_post", label: "Payroll post", group: "Payroll", description: "Post payroll journals to ledger." },
  { key: "pos_orders_edit", label: "Edit POS orders", group: "Sales Operations", description: "Edit/reverse POS orders." },
  { key: "cash_receipts_edit", label: "Edit cash receipts", group: "Sales Operations", description: "Edit/reverse cash receipts." },
  { key: "stock_adjustments_delete", label: "Delete stock adjustments", group: "Inventory", description: "Delete complete stock adjustment batches." },
];

const CACHE_KEY = "boat.permissions.snapshot.v2";
const PAGE_PERMISSION_PREFIX = "page:";

export type PageAccessDef = {
  page: string;
  label: string;
  group:
    | "Dashboard"
    | "Front desk"
    | "POS"
    | "Customers"
    | "Cash"
    | "Treasury"
    | "Purchases"
    | "Inventory"
    | "Reports"
    | "Accounting"
    | "Practice"
    | "Payroll"
    | "Admin";
};

export const PAGE_ACCESS_DEFS: PageAccessDef[] = [
  { page: "dashboard", label: "Dashboard", group: "Dashboard" },
  { page: "retail_dashboard", label: "Retail dashboard", group: "Dashboard" },
  { page: "clinic_dashboard", label: "Clinic dashboard", group: "Dashboard" },
  { page: "practice_dashboard", label: "Practice dashboard", group: "Practice" },
  { page: "practice_clients", label: "Clients", group: "Practice" },
  { page: "practice_engagements", label: "Engagements", group: "Practice" },
  { page: "practice_documents", label: "Document Vault", group: "Practice" },
  { page: "practice_reconciliation", label: "Reconciliation Center", group: "Practice" },
  { page: "practice_stock_take", label: "Stock Take", group: "Practice" },
  { page: "asset_verification", label: "Asset Verification", group: "Practice" },
  { page: "practice_tasks", label: "Tasks & Deadlines", group: "Practice" },
  { page: "practice_billing", label: "Billing", group: "Practice" },
  { page: "rooms", label: "Rooms", group: "Front desk" },
  { page: "reservations", label: "Reservations", group: "Front desk" },
  { page: "checkin", label: "Check in", group: "Front desk" },
  { page: "stays", label: "Active stays", group: "Front desk" },
  { page: "housekeeping", label: "Housekeeping", group: "Front desk" },
  { page: "POS", label: "Hotel POS", group: "POS" },
  { page: "hotel_pos_waiter", label: "Waiter POS", group: "POS" },
  { page: "hotel_pos_kitchen_bar", label: "Kitchen / bar POS", group: "POS" },
  { page: "hotel_pos_supervisor", label: "Supervisor POS", group: "POS" },
  { page: "hotel_pos_reports", label: "POS analytics", group: "POS" },
  { page: "retail_pos", label: "Retail POS", group: "POS" },
  { page: "retail_pos_orders", label: "Retail POS orders", group: "POS" },
  { page: "clinic_pos", label: "Clinic POS", group: "POS" },
  { page: "Kitchen Orders", label: "Kitchen orders", group: "POS" },
  { page: "Bar Orders", label: "Bar orders", group: "POS" },
  { page: "kitchen_display", label: "Kitchen display", group: "POS" },
  { page: "kitchen_menu", label: "Kitchen menu", group: "POS" },
  { page: "hotel_customers", label: "Hotel customers", group: "Customers" },
  { page: "retail_customers", label: "Retail customers", group: "Customers" },
  { page: "retail_credit_invoices", label: "Credit invoices / debtors", group: "Customers" },
  { page: "clinic_patients", label: "Clinic patients", group: "Customers" },
  { page: "clinic_consultation", label: "Clinic consultation", group: "Customers" },
  { page: "clinic_laboratory", label: "Clinic laboratory", group: "Customers" },
  { page: "billing", label: "Billing", group: "Cash" },
  { page: "payments", label: "Payments", group: "Cash" },
  { page: "cash_receipts", label: "Cash receipts", group: "Cash" },
  { page: "transactions", label: "Transactions", group: "Cash" },
  { page: "wallet", label: "Wallet", group: "Cash" },
  { page: "treasury", label: "Treasury page", group: "Treasury" },
  { page: "purchases_vendors", label: "Vendors", group: "Purchases" },
  { page: "purchases_orders", label: "Purchase orders", group: "Purchases" },
  { page: "purchases_bills", label: "GRN / bills", group: "Purchases" },
  { page: "purchases_payments", label: "Vendor payments", group: "Purchases" },
  { page: "purchases_credits", label: "Return to supplier", group: "Purchases" },
  { page: "purchases_expenses", label: "Spend money / expenses", group: "Purchases" },
  { page: "purchases_cash_out_reconciliation", label: "Cash-out reconciliation", group: "Purchases" },
  { page: "Products", label: "Items", group: "Inventory" },
  { page: "inventory_barcodes", label: "Barcodes", group: "Inventory" },
  { page: "inventory_stock_adjustments", label: "Stock adjustments", group: "Inventory" },
  { page: "inventory_stock_balances", label: "Stock balances", group: "Inventory" },
  { page: "inventory_store_requisitions", label: "Store requisitions", group: "Inventory" },
  { page: "reports", label: "Reports hub", group: "Reports" },
  { page: "reports_daily_sales", label: "Daily sales", group: "Reports" },
  { page: "reports_daily_summary", label: "Daily summary", group: "Reports" },
  { page: "reports_retail_shift_variance", label: "Shift variance", group: "Reports" },
  { page: "reports_retail_sales_insights", label: "Sales insights", group: "Reports" },
  { page: "reports_financial_revenue_by_type", label: "Revenue by type", group: "Reports" },
  { page: "reports_financial_payments_by_method", label: "Payments by method", group: "Reports" },
  { page: "reports_financial_payments_by_charge_type", label: "Payments by charge type", group: "Reports" },
  { page: "reports_sales_by_item", label: "Sales by item", group: "Reports" },
  { page: "reports_room_billing", label: "Room billing", group: "Reports" },
  { page: "accounting_pos_income_reconciliation", label: "POS income reconciliation", group: "Reports" },
  { page: "reports_daily_purchases_summary", label: "Purchases summary", group: "Reports" },
  { page: "reports_purchases_by_item", label: "Purchases by item", group: "Reports" },
  { page: "reports_expenses", label: "Expenses report", group: "Reports" },
  { page: "reports_stock_summary", label: "Stock summary", group: "Reports" },
  { page: "reports_stock_movement", label: "Stock movement", group: "Reports" },
  { page: "reports_budget_variance", label: "Budget variance", group: "Reports" },
  { page: "retail_credit_sales_report", label: "Credit sales report", group: "Reports" },
  { page: "reports_manufacturing_daily_production", label: "Daily production", group: "Reports" },
  { page: "gl_accounts", label: "Chart of accounts", group: "Accounting" },
  { page: "accounting_journal", label: "Journal entries", group: "Accounting" },
  { page: "accounting_manual", label: "Manual journals", group: "Accounting" },
  { page: "accounting_gl", label: "General ledger", group: "Accounting" },
  { page: "accounting_bank_reconciliation", label: "Cash & float reconciliation", group: "Accounting" },
  { page: "accounting_trial", label: "Trial balance", group: "Accounting" },
  { page: "accounting_income", label: "Income statement", group: "Accounting" },
  { page: "accounting_balance", label: "Balance sheet", group: "Accounting" },
  { page: "accounting_cashflow", label: "Cash flow", group: "Accounting" },
  { page: "accounting_budgeting", label: "Budgeting", group: "Accounting" },
  { page: "fixed_assets", label: "Fixed assets", group: "Accounting" },
  { page: "payroll_hub", label: "Payroll overview", group: "Payroll" },
  { page: "payroll_staff", label: "Payroll staff", group: "Payroll" },
  { page: "payroll_settings", label: "Payroll settings", group: "Payroll" },
  { page: "payroll_loans", label: "Payroll loans", group: "Payroll" },
  { page: "payroll_periods", label: "Payroll periods", group: "Payroll" },
  { page: "payroll_run", label: "Payroll process", group: "Payroll" },
  { page: "payroll_audit", label: "Payroll audit", group: "Payroll" },
  { page: "staff", label: "Staff", group: "Admin" },
  { page: "admin", label: "Admin settings", group: "Admin" },
];

export function pagePermissionKey(page: string): string {
  return `${PAGE_PERMISSION_PREFIX}${page}`;
}

const SUPER_ADMIN_REPORT_PAGES = new Set([
  "hotel_pos_reports",
  "accounting_trial",
  "accounting_income",
  "accounting_balance",
  "accounting_cashflow",
]);

export function isSuperAdminControlledReportPage(page: PageAccessDef): boolean {
  return page.group === "Reports" || SUPER_ADMIN_REPORT_PAGES.has(page.page);
}

type PermissionSnapshot = {
  orgId: string;
  staffId: string;
  role: string;
  grants: Record<string, boolean>;
  loadedAt: number;
};

export function readPermissionSnapshot(): PermissionSnapshot | null {
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
  if (input.isSuperAdmin || role === "super_admin") {
    const grants = Object.fromEntries([
      ...PERMISSION_KEYS.map((k) => [k, true] as const),
      ...PAGE_ACCESS_DEFS.map((p) => [pagePermissionKey(p.page), true] as const),
    ]);
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

  /** Only keys present in DB — missing rows fall back to role defaults in `canApprove`. */
  const grants: Record<string, boolean> = {};
  // Page visibility is controlled per user. Historical role-level page rows are
  // intentionally ignored so a role cannot silently hide operational pages.
  for (const row of roleRows || []) {
    const key = String(row.permission_key);
    if (!key.startsWith(PAGE_PERMISSION_PREFIX)) grants[key] = !!row.allowed;
  }
  for (const row of overrideRows || []) grants[String(row.permission_key)] = !!row.allowed;

  writeSnapshot({ orgId, staffId, role, grants, loadedAt: Date.now() });
  return grants;
}

function roleDefaultAllows(permission: PermissionKey, roleKey: string): boolean {
  if (roleKey === "super_admin") return true;
  if (permission === "purchase_orders") return roleKey === "admin" || roleKey === "manager";
  if (permission === "bills") return roleKey === "admin" || roleKey === "manager" || roleKey === "accountant";
  if (permission === "vendor_credits") return roleKey === "admin" || roleKey === "manager";
  if (permission === "chart_of_accounts") return roleKey === "admin" || roleKey === "manager";
  if (permission === "sacco_savings_settings") return roleKey === "admin" || roleKey === "manager";
  if (permission === "sacco_transaction_edit") return roleKey === "admin" || roleKey === "manager" || roleKey === "accountant";
  if (permission === "payroll_prepare") return roleKey === "admin" || roleKey === "manager" || roleKey === "accountant";
  if (permission === "payroll_approve") return roleKey === "admin" || roleKey === "manager";
  if (permission === "payroll_post") return roleKey === "admin" || roleKey === "accountant";
  if (permission === "pos_orders_edit" || permission === "cash_receipts_edit") {
    return roleKey === "admin" || roleKey === "manager" || roleKey === "accountant" || roleKey === "supervisor";
  }
  if (permission === "stock_adjustments_delete") return roleKey === "admin" || roleKey === "manager";
  return false;
}

export function canApprove(permission: PermissionKey, role?: string | null): boolean {
  const rl = String(role || "").toLowerCase();
  if (rl === "super_admin") return true;
  const snapshot = readPermissionSnapshot();
  if (snapshot?.grants && Object.prototype.hasOwnProperty.call(snapshot.grants, permission)) {
    return !!snapshot.grants[permission];
  }
  return roleDefaultAllows(permission, rl);
}

export function hasConfiguredPageAccess(): boolean {
  const snapshot = readPermissionSnapshot();
  return Object.keys(snapshot?.grants ?? {}).some((key) => key.startsWith(PAGE_PERMISSION_PREFIX));
}

export function pageAccessDecision(page: string): boolean | null {
  const snapshot = readPermissionSnapshot();
  if (snapshot?.role === "super_admin") return true;
  const grants = snapshot?.grants ?? {};
  const key = pagePermissionKey(page);
  if (Object.prototype.hasOwnProperty.call(grants, key)) return !!grants[key];
  return null;
}

