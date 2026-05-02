import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Banknote,
  CreditCard,
  ShoppingCart,
  Package,
  TrendingUp,
  Settings,
  BedDouble,
  Receipt,
} from "lucide-react";
import type { BusinessType } from "@/contexts/AuthContext";
import { PAYROLL_PAGE } from "@/lib/payrollPages";

export type NavChild =
  | { name: string; page: string }
  | { group: string; items: { name: string; page: string }[] };

export type NavLeaf = { name: string; icon: LucideIcon; page: string };
export type NavItem =
  | NavLeaf
  | { name: string; icon: LucideIcon; children: NavChild[] };

export type BuildSimpleOrgNavArgs = {
  businessType: BusinessType | null | undefined;
  dashboardPage: string;
  allowWallet: boolean;
  allowPayroll: boolean;
  allowCommunications: boolean;
  allowManufacturing: boolean;
  allowBudget: boolean;
};

/**
 * Primary sidebar for hotel / retail / restaurant / mixed / manufacturing tenants
 * (replaces the legacy multi-section Finance / Purchases tree).
 */
export function buildSimpleOrgNavigation(args: BuildSimpleOrgNavArgs): NavItem[] {
  const {
    businessType,
    dashboardPage,
    allowWallet,
    allowPayroll,
    allowCommunications,
    allowManufacturing,
    allowBudget,
  } = args;

  const isHotelOrMixed = businessType === "hotel" || businessType === "mixed";
  const isRestaurant = businessType === "restaurant";
  /** Guest-facing ops + POS; retail-only keeps a single “Sales” group */
  const useHotelStyleOps = isHotelOrMixed || isRestaurant;

  const moneyIn: NavChild[] = [
    { name: "Receive money", page: "cash_receipts" },
    { name: "Customer payments", page: "payments" },
    ...(isHotelOrMixed ? [{ name: "Guest billing", page: "billing" as const }] : []),
    { name: "Transactions", page: "transactions" },
    ...(allowWallet ? [{ name: "Wallet", page: "wallet" as const }] : []),
  ];

  const moneyOut: NavChild[] = [
    { name: "Spend money", page: "purchases_expenses" },
    { name: "Pay suppliers", page: "purchases_payments" },
    /** Distinct from customer payments — general cash / ledger movements */
    { name: "Other payments", page: "transactions" },
  ];

  const retailSales: NavChild[] = [
    { name: "POS", page: "retail_pos" },
    { name: "Orders", page: "retail_pos_orders" },
    { name: "Customers", page: "retail_customers" },
    { name: "Invoices", page: "retail_credit_invoices" },
  ];

  const stock: NavChild[] = [
    { name: "Items", page: "Products" },
    { name: "Buy stock", page: "purchases_orders" },
    { name: "Suppliers", page: "purchases_vendors" },
    { name: "Stock levels", page: "inventory_stock_balances" },
    { name: "Adjust stock", page: "inventory_stock_adjustments" },
  ];

  const reports: NavChild[] = [
    { name: "Daily summary", page: "reports_daily_summary" },
    { name: "Sales report", page: "reports_daily_sales" },
    { name: "Purchases report", page: "reports_daily_purchases_summary" },
    { name: "Income statement", page: "accounting_income" },
    { name: "Balance sheet", page: "accounting_balance" },
  ];

  const settings: NavChild[] = [
    { name: "Users", page: "staff" },
    { name: "System settings", page: "admin" },
    ...(allowCommunications ? [{ name: "Communications", page: "communications" }] : []),
    { name: "Chart of accounts", page: "gl_accounts" },
    { name: "Journal entries", page: "accounting_journal" },
  ];
  if (allowPayroll) {
    settings.push({ name: "Payroll", page: PAYROLL_PAGE.hub });
  }
  settings.push({ name: "Integrations", page: "system_integrations" });
  if (allowBudget) {
    settings.push({ name: "Budgeting", page: "accounting_budgeting" });
  }
  if (allowManufacturing) {
    settings.push(
      { name: "Manufacturing", page: "manufacturing" },
      { name: "Recipes / BOM", page: "manufacturing_bom" },
      { name: "Production orders", page: "manufacturing_work_orders" }
    );
  }

  const frontDesk: NavItem | null = isHotelOrMixed
    ? {
        name: "Front Desk",
        icon: BedDouble,
        children: [
          { name: "Reservations", page: "reservations" },
          { name: "Check-in", page: "checkin" },
          { name: "Active stays", page: "stays" },
          { name: "Housekeeping", page: "housekeeping" },
          { name: "Rooms setup", page: "rooms" },
        ],
      }
    : null;

  /** Hospitality POS vs retail POS stay distinct: hotels/restaurants open waiter POS; standalone retail keeps Sales → Retail POS */
  const posOrdersChildren: NavChild[] = [
    {
      name: "Kitchen, bar & sauna",
      page: "hotel_pos_kitchen_bar",
    },
    { name: "Hotel POS", page: "hotel_pos_waiter" },
  ];
  if (businessType === "mixed") {
    posOrdersChildren.push(
      { name: "Retail POS", page: "retail_pos" },
      { name: "Retail orders", page: "retail_pos_orders" },
    );
  }

  /** Hotel & restaurant / mixed: operations POS / kitchen — billing stays under Money In */
  const posOrders: NavItem | null = useHotelStyleOps
    ? {
        name: "POS / Orders",
        icon: Receipt,
        children: posOrdersChildren,
      }
    : null;

  const core: NavItem[] = [
    { name: "Dashboard", icon: LayoutDashboard, page: dashboardPage },
    ...(frontDesk ? [frontDesk] : []),
    ...(posOrders ? [posOrders] : []),
    { name: "Money In", icon: Banknote, children: moneyIn },
    { name: "Money Out", icon: CreditCard, children: moneyOut },
  ];

  if (!useHotelStyleOps) {
    core.push({ name: "Sales", icon: ShoppingCart, children: retailSales });
  }

  core.push(
    { name: "Stock", icon: Package, children: stock },
    { name: "Reports", icon: TrendingUp, children: reports },
    { name: "Settings", icon: Settings, children: settings }
  );

  return core;
}
