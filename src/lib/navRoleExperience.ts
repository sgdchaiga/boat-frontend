import type { BusinessType } from "@/contexts/AuthContext";

export type NavRoleExperience = "full" | "cashier" | "storekeeper";

/** POS counter, guest linkage, retail till, hotel bar/kitchen pipelines. */
export const NAV_ROLE_CASHIER_PAGE_IDS = new Set<string>([
  "dashboard",
  "hotel_customers",
  "retail_customers",
  "hotel_pos_waiter",
  "hotel_pos_kitchen_bar",
  "hotel_pos_supervisor",
  "hotel_pos_reports",
  "retail_dashboard",
  "retail_pos",
  "retail_pos_orders",
  "retail_credit_invoices",
  "Kitchen Orders",
  "Bar Orders",
  "kitchen_display",
  "kitchen_menu",
  /** Simple nav — money in / out often used at the counter */
  "cash_receipts",
  "payments",
  "transactions",
  "wallet",
  "purchases_expenses",
  "purchases_payments",
  /** Front Desk (hotel / mixed) */
  "reservations",
  "checkin",
  "stays",
  "housekeeping",
  "rooms",
  "billing",
]);

/** Stores + procure-to-pay; includes expense capture used as operational buying. */
export const NAV_ROLE_STOREKEEPER_PAGE_IDS = new Set<string>([
  "dashboard",
  "Products",
  "inventory_barcodes",
  "inventory_stock_adjustments",
  "inventory_stock_balances",
  "inventory_store_requisitions",
  "purchases_vendors",
  "purchases_orders",
  "purchases_bills",
  "purchases_payments",
  "purchases_credits",
  "purchases_expenses",
  "cash_receipts",
  "transactions",
  "wallet",
  "payments",
  "reports_daily_purchases_summary",
  "reports_stock_movement",
  "reports_purchases_by_item",
]);

export function getNavRoleExperience(roleKey: string | undefined | null): NavRoleExperience {
  const r = (roleKey ?? "").trim().toLowerCase();
  if (!r) return "full";
  if (r === "cashier") return "cashier";
  if (r === "storekeeper") return "storekeeper";
  /** Manager / admin / receptionist / accountant etc. retain full sidebar (module gates still apply). */
  return "full";
}

export function shouldApplyNavRoleScope(businessType: BusinessType | null | undefined): boolean {
  if (!businessType) return false;
  return businessType === "hotel" || businessType === "mixed" || businessType === "restaurant" || businessType === "retail";
}

export function shouldApplyStorekeeperScope(businessType: BusinessType | null | undefined): boolean {
  return shouldApplyNavRoleScope(businessType) || businessType === "manufacturing";
}

/**
 * Sidebar + route guard: when scope applies and role narrows UX, pages outside the allow‑list are hidden.
 */
export function isPageAllowedForNavRole(
  page: string,
  roleKey: string | undefined | null,
  businessType: BusinessType | null | undefined
): boolean {
  const xp = getNavRoleExperience(roleKey);
  if (xp === "full") return true;

  if (xp === "storekeeper") {
    if (!shouldApplyStorekeeperScope(businessType)) return true;
    return NAV_ROLE_STOREKEEPER_PAGE_IDS.has(page);
  }

  /** cashier */
  if (!shouldApplyNavRoleScope(businessType)) return true;
  return NAV_ROLE_CASHIER_PAGE_IDS.has(page);
}

export function defaultLandingPageForNavRole(
  roleKey: string | undefined | null,
  businessType: BusinessType | null | undefined
): string | null {
  const xp = getNavRoleExperience(roleKey);
  if (xp === "full") return null;

  if (xp === "storekeeper") {
    if (!shouldApplyStorekeeperScope(businessType)) return null;
    return "Products";
  }

  if (!shouldApplyNavRoleScope(businessType)) return null;
  if (businessType === "retail") return "retail_pos";
  return "hotel_pos_waiter";
}
