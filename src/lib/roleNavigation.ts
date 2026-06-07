import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Grid3x3,
  ClipboardList,
  Receipt,
  Users,
  ChefHat,
  Wine,
  Package,
  BookOpen,
  CreditCard,
  Banknote,
  FileText,
  Scale,
  TrendingUp,
  BarChart3,
  Monitor,
} from "lucide-react";
import { HOTEL_PAGE } from "@/lib/hotelPages";
import {
  getNavRoleExperience,
  normalizeNavRoleKey,
  type NavRoleExperience,
} from "@/lib/navRoleExperience";
import type { BusinessType } from "@/contexts/AuthContext";

export type RoleNavLeaf = {
  name: string;
  icon: LucideIcon;
  page: string;
  state?: Record<string, unknown>;
};

const W = HOTEL_PAGE.posWaiter;

/** Page ids allowed per scoped role (route guard + sidebar filter). */
export const ROLE_PAGE_ALLOW: Record<Exclude<NavRoleExperience, "full">, Set<string>> = {
  waitress: new Set([
    "dashboard",
    W,
    "POS",
    "hotel_customers",
    "billing",
    "Kitchen Orders",
    "kitchen_display",
  ]),
  bartender: new Set([
    "dashboard",
    "Bar Orders",
    HOTEL_PAGE.posKitchenBar,
    "reports_stock_movement",
    "kitchen_menu",
  ]),
  kitchen: new Set(["dashboard", "Kitchen Orders", "kitchen_display"]),
  cashier: new Set([
    "dashboard",
    W,
    "POS",
    HOTEL_PAGE.posKitchenBar,
    "retail_pos",
    "retail_pos_orders",
    "billing",
    "payments",
    "cash_receipts",
    "reports_daily_sales",
    "reports_retail_shift_variance",
    "hotel_customers",
    "retail_customers",
  ]),
  accountant: new Set([
    "dashboard",
    "gl_accounts",
    "accounting_journal",
    "accounting_gl",
    "accounting_trial",
    "accounting_income",
    "accounting_balance",
    "accounting_cashflow",
    "accounting_manual",
    "reports",
    "reports_daily_sales",
    "reports_daily_summary",
    "reports_expenses",
    "reports_financial_revenue_by_type",
    "reports_financial_payments_by_method",
    "reports_financial_payments_by_charge_type",
    "reports_sales_by_item",
    "reports_room_billing",
    "reports_stock_movement",
    "inventory_stock_balances",
    "payments",
    "cash_receipts",
    "transactions",
    "retail_credit_invoices",
  ]),
  manager: new Set([
    "dashboard",
    HOTEL_PAGE.posSupervisor,
    HOTEL_PAGE.posReports,
    "hotel_pos_reports",
    "reports",
    "reports_daily_sales",
    "reports_daily_summary",
    "reports_sales_by_item",
    "reports_room_billing",
    "reports_stock_movement",
    "accounting_cashflow",
    "billing",
    "payments",
    "stays",
    "rooms",
    W,
    "POS",
  ]),
  storekeeper: new Set([
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
    "accounting_manual",
    "transactions",
    "wallet",
    "payments",
    "reports_daily_purchases_summary",
    "reports_expenses",
    "reports_stock_movement",
    "reports_purchases_by_item",
    "retail_credit_invoices",
    "accounting_cashflow",
  ]),
};

export function getRolePageAllowList(xp: NavRoleExperience): Set<string> | null {
  if (xp === "full") return null;
  return ROLE_PAGE_ALLOW[xp];
}

export function getRoleBasedNavMenuTitle(roleKey: string | undefined | null): string | null {
  const r = (roleKey ?? "").trim().toLowerCase();
  const titles: Record<string, string> = {
    waitress: "Waitress Menu",
    waiter: "Waiter Menu",
    bartender: "Bartender Menu",
    barman: "Bartender Menu",
    kitchen: "Kitchen Menu",
    kitchen_staff: "Kitchen Menu",
    cashier: "Cashier Menu",
    accountant: "Accountant Menu",
    manager: "Manager Dashboard",
    storekeeper: "Store Menu",
  };
  return titles[r] ?? null;
}

function waitressNav(): RoleNavLeaf[] {
  return [
    { name: "New Order", icon: ClipboardList, page: W, state: { posPanel: "new" } },
    { name: "Tables", icon: Grid3x3, page: W, state: { posPanel: "tables" } },
    { name: "Customers", icon: Users, page: "hotel_customers" },
    { name: "Pending Bills", icon: Receipt, page: "billing" },
    { name: "Print KOT", icon: ChefHat, page: "Kitchen Orders" },
    { name: "Mobile Order Status", icon: Monitor, page: "kitchen_display" },
  ];
}

function bartenderNav(): RoleNavLeaf[] {
  return [
    { name: "Drink Queue", icon: Wine, page: "Bar Orders", state: { barView: "queue" } },
    { name: "Pending Bar Orders", icon: ClipboardList, page: "Bar Orders", state: { barView: "pending" } },
    { name: "Completed Orders", icon: Receipt, page: "Bar Orders", state: { barView: "completed" } },
    { name: "Inventory consumption", icon: Package, page: "reports_stock_movement" },
    { name: "Cocktail recipes", icon: BookOpen, page: "kitchen_menu" },
  ];
}

function kitchenNav(): RoleNavLeaf[] {
  return [
    { name: "Kitchen tickets (KOT)", icon: ChefHat, page: "Kitchen Orders" },
    { name: "Food prep queue", icon: ClipboardList, page: "kitchen_display" },
  ];
}

function cashierNav(businessType: BusinessType | null | undefined): RoleNavLeaf[] {
  const posPage =
    businessType === "retail" || businessType === "clinic" ? "retail_pos" : W;
  const ordersPage = businessType === "retail" ? "retail_pos_orders" : W;
  return [
    { name: "POS billing", icon: CreditCard, page: posPage },
    { name: "Payments", icon: Banknote, page: "payments" },
    { name: "Shift close", icon: Scale, page: "reports_retail_shift_variance" },
    { name: "Daily sales", icon: TrendingUp, page: "reports_daily_sales" },
    { name: "Reprint receipt", icon: FileText, page: ordersPage, state: { posPanel: "orders" } },
  ];
}

function accountantNav(): RoleNavLeaf[] {
  return [
    { name: "Journals", icon: FileText, page: "accounting_journal" },
    { name: "Ledger", icon: BookOpen, page: "accounting_gl" },
    { name: "Trial balance", icon: Scale, page: "accounting_trial" },
    { name: "Financial reports", icon: TrendingUp, page: "reports" },
    { name: "Income statement", icon: BarChart3, page: "accounting_income" },
    { name: "Cash flow", icon: Banknote, page: "accounting_cashflow" },
    { name: "Stock valuation", icon: Package, page: "inventory_stock_balances" },
    { name: "Chart of accounts", icon: BookOpen, page: "gl_accounts" },
  ];
}

function managerNav(): RoleNavLeaf[] {
  return [
    { name: "Overview", icon: LayoutDashboard, page: "dashboard" },
    { name: "POS analytics", icon: BarChart3, page: HOTEL_PAGE.posReports },
    { name: "Daily sales", icon: TrendingUp, page: "reports_daily_sales" },
    { name: "Top-selling items", icon: Package, page: "reports_sales_by_item" },
    { name: "Cash flow", icon: Banknote, page: "accounting_cashflow" },
    { name: "Low stock", icon: Package, page: "reports_stock_movement" },
    { name: "Active stays", icon: Users, page: "stays" },
    { name: "Supervisor POS", icon: CreditCard, page: HOTEL_PAGE.posSupervisor },
  ];
}

export function buildRoleNavigation(
  roleKey: string | undefined | null,
  businessType: BusinessType | null | undefined
): RoleNavLeaf[] | null {
  const xp = getNavRoleExperience(roleKey);
  switch (xp) {
    case "waitress":
      return waitressNav();
    case "bartender":
      return bartenderNav();
    case "kitchen":
      return kitchenNav();
    case "cashier":
      return cashierNav(businessType);
    case "accountant":
      return accountantNav();
    case "manager":
      return managerNav();
    case "storekeeper":
      return [
        { name: "Dashboard", icon: LayoutDashboard, page: "dashboard" },
        { name: "Items", icon: Package, page: "Products" },
        { name: "Stock levels", icon: Package, page: "inventory_stock_balances" },
        { name: "Buy stock", icon: ClipboardList, page: "purchases_orders" },
      ];
    default:
      return null;
  }
}

export function hasRoleScopedNavigation(
  roleKey: string | undefined | null,
  businessType: BusinessType | null | undefined
): boolean {
  if (!businessType) return false;
  const hospitality =
    businessType === "hotel" || businessType === "mixed" || businessType === "restaurant";
  const xp = getNavRoleExperience(roleKey);
  if (xp === "full") return false;
  if (xp === "storekeeper") {
    return businessType === "retail" || businessType === "clinic" || hospitality || businessType === "manufacturing";
  }
  if (xp === "cashier" || xp === "accountant") {
    return (
      businessType === "hotel" ||
      businessType === "mixed" ||
      businessType === "restaurant" ||
      businessType === "retail" ||
      businessType === "clinic"
    );
  }
  return hospitality;
}

export function defaultLandingPageForRole(
  roleKey: string | undefined | null,
  businessType: BusinessType | null | undefined
): string | null {
  const xp = getNavRoleExperience(roleKey);
  if (xp === "full") return null;
  if (xp === "waitress") return W;
  if (xp === "bartender") return "Bar Orders";
  if (xp === "kitchen") return "Kitchen Orders";
  if (xp === "cashier") {
    if (businessType === "clinic") return "clinic_pos";
    if (businessType === "retail") return "retail_pos";
    return W;
  }
  if (xp === "accountant") return "accounting_journal";
  if (xp === "manager") return "dashboard";
  if (xp === "storekeeper") return "Products";
  return null;
}

export function defaultLandingStateForRole(
  roleKey: string | undefined | null
): Record<string, unknown> | undefined {
  const r = normalizeNavRoleKey(roleKey);
  if (r === "waitress") return { posPanel: "new" };
  if (r === "bartender") return { barView: "queue" };
  return undefined;
}
