const FULL_PRACTICE_ROLES = new Set(["owner", "admin", "super_admin"]);

const COMMON_PAGES = [
  "practice_dashboard",
  "practice_my_work",
  "practice_documents",
  "practice_document_requests",
  "practice_tasks",
  "practice_time_expenses",
  "practice_mobile",
  "learning_centre",
] as const;

const ROLE_PAGES: Record<string, readonly string[]> = {
  manager: [
    ...COMMON_PAGES,
    "practice_clients", "practice_engagements", "practice_support", "image_document_converter",
    "practice_reconciliation", "practice_stock_take", "asset_verification",
    "practice_housekeeping_audit", "practice_annual_accounts", "practice_billing",
    "practice_renewals", "practice_profitability", "practice_activity", "practice_sales",
    "practice_quality", "practice_capacity", "practice_client_portal", "practice_advanced",
    "practice_integrations", "staff",
  ],
  finance_manager: [
    ...COMMON_PAGES,
    "practice_clients", "practice_engagements", "practice_reconciliation",
    "practice_annual_accounts", "practice_billing", "practice_renewals",
    "practice_profitability", "practice_activity", "practice_sales", "practice_capacity",
  ],
  accountant: [
    ...COMMON_PAGES,
    "practice_clients", "practice_engagements", "practice_support", "image_document_converter",
    "practice_reconciliation", "practice_stock_take", "asset_verification",
    "practice_annual_accounts", "practice_billing", "practice_activity", "practice_quality",
    "practice_client_portal",
  ],
  auditor: [
    ...COMMON_PAGES,
    "practice_clients", "practice_engagements", "image_document_converter",
    "practice_stock_take", "asset_verification", "practice_housekeeping_audit",
    "practice_activity", "practice_quality", "practice_client_portal",
  ],
  bookkeeper: [
    ...COMMON_PAGES,
    "practice_clients", "practice_engagements", "practice_support",
    "practice_reconciliation", "practice_annual_accounts", "practice_billing",
  ],
  cashier: [
    ...COMMON_PAGES,
    "practice_clients", "practice_billing", "practice_renewals", "practice_sales",
  ],
  receptionist: [
    ...COMMON_PAGES,
    "practice_clients", "practice_engagements", "practice_support", "practice_client_portal",
  ],
  storekeeper: [
    ...COMMON_PAGES,
    "practice_clients", "practice_stock_take", "asset_verification", "practice_housekeeping_audit",
  ],
};

function normalizeRole(role: string | null | undefined): string {
  const normalized = String(role ?? "").trim().toLowerCase();
  if (normalized === "supervisor") return "manager";
  if (normalized === "audit_associate") return "auditor";
  if (normalized === "accounts_assistant") return "bookkeeper";
  return normalized;
}

export function practicePageAllowList(role: string | null | undefined): Set<string> | null {
  const normalized = normalizeRole(role);
  if (FULL_PRACTICE_ROLES.has(normalized)) return null;
  return new Set(ROLE_PAGES[normalized] ?? COMMON_PAGES);
}

export function isPracticePageAllowed(page: string, role: string | null | undefined): boolean {
  const allowed = practicePageAllowList(role);
  return allowed === null || allowed.has(page);
}

export function practiceLandingPage(role: string | null | undefined): string {
  const allowed = practicePageAllowList(role);
  if (allowed === null || allowed.has("practice_clients")) return "practice_clients";
  return "practice_dashboard";
}
