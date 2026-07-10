import type { BusinessType } from "@/contexts/AuthContext";
import { getSimpleOrgReportNavChildren, type NavChild } from "@/lib/simpleOrgNavigation";
import { isSidebarLeafActive } from "@/lib/navSidebarActiveLeaf";

export type ReportHubLeaf = { name: string; page: string; state?: Record<string, unknown> };

export type ReportHubCategory = { id: string; label: string; items: ReportHubLeaf[] };

const SALES_PAGES = new Set([
  "reports_daily_summary",
  "reports_daily_sales",
  "reports_pos_cash_collections",
  "reports_sales_by_item",
  "reports_room_billing",
]);
const PURCHASES_PAGES = new Set([
  "reports_daily_purchases_summary",
  "reports_purchases_by_item",
  "reports_expenses",
]);
const INVENTORY_PAGES = new Set([
  "reports_stock_summary",
  "reports_stock_movement",
  "reports_stock_adjustments",
  "reports_manufacturing_daily_production",
  "manufacturing_wip_report",
  "manufacturing_account",
]);
const FINANCIAL_PAGES = new Set(["accounting_income", "accounting_balance", "accounting_cashflow", "accounting_pos_income_reconciliation"]);
const RECEIVABLES_PAGES = new Set(["retail_credit_invoices"]);

function classifyReportLeaf(page: string): string | null {
  if (SALES_PAGES.has(page)) return "sales";
  if (PURCHASES_PAGES.has(page)) return "purchases";
  if (INVENTORY_PAGES.has(page)) return "inventory";
  if (FINANCIAL_PAGES.has(page)) return "financial";
  if (RECEIVABLES_PAGES.has(page)) return "receivables";
  return null;
}

function isFlatReportChild(c: NavChild): c is ReportHubLeaf {
  return "page" in c && typeof c.page === "string";
}

/**
 * Categorized report picker for simple-org tenants (matches sidebar report list).
 */
export function getSimpleOrgReportHubCategories(
  businessType: BusinessType | null | undefined,
  canShowPage: (page: string) => boolean
): ReportHubCategory[] {
  const raw = getSimpleOrgReportNavChildren({ businessType });
  const leaves: ReportHubLeaf[] = [];
  for (const c of raw) {
    if (!isFlatReportChild(c)) continue;
    if (!canShowPage(c.page)) continue;
    leaves.push({ name: c.name, page: c.page, state: c.state });
  }

  const buckets: Record<string, ReportHubLeaf[]> = {
    sales: [],
    purchases: [],
    inventory: [],
    financial: [],
    receivables: [],
  };

  for (const leaf of leaves) {
    const key = classifyReportLeaf(leaf.page);
    if (!key || !buckets[key]) continue;
    buckets[key]!.push(leaf);
  }

  const order: { id: keyof typeof buckets; label: string }[] = [
    { id: "sales", label: "Sales & activity" },
    { id: "purchases", label: "Purchases & expenses" },
    { id: "inventory", label: "Inventory & production" },
    { id: "financial", label: "Financial statements" },
    { id: "receivables", label: "Receivables & debtors" },
  ];

  return order
    .map((o) => ({
      id: o.id,
      label: o.label,
      items: buckets[o.id]!,
    }))
    .filter((c) => c.items.length > 0);
}

export function isSimpleOrgReportHubRoute(
  businessType: BusinessType | null | undefined,
  currentPage: string,
  pageState: Record<string, unknown>,
  canShowPage: (page: string) => boolean
): boolean {
  const cats = getSimpleOrgReportHubCategories(businessType, canShowPage);
  return cats.some((c) => c.items.some((leaf) => isSidebarLeafActive(leaf, currentPage, pageState)));
}

/** Default route when opening Reports from the sidebar (in-page hub picks category + report). */
export function getSimpleOrgDefaultReportRoute(
  businessType: BusinessType | null | undefined,
  canShowPage?: (page: string) => boolean
): string {
  const canShow = canShowPage ?? (() => true);
  const cats = getSimpleOrgReportHubCategories(businessType, canShow);
  for (const cat of cats) {
    const first = cat.items[0];
    if (first) return first.page;
  }
  return "reports_daily_summary";
}
