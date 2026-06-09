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
  Stethoscope,
} from "lucide-react";
import type { BusinessType } from "@/contexts/AuthContext";
import { PAYROLL_PAGE } from "@/lib/payrollPages";
import { getSimpleOrgDefaultReportRoute } from "@/lib/reportHubCatalog";

export type NavChild =
  | { name: string; page: string; state?: Record<string, unknown> }
  | { group: string; items: { name: string; page: string; state?: Record<string, unknown> }[] };

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

/** Flat report links for simple-org tenants (sidebar + in-app report hub). */
export function getSimpleOrgReportNavChildren(args: { businessType: BusinessType | null | undefined }): NavChild[] {
  const { businessType } = args;
  const isHotelOrMixed = businessType === "hotel" || businessType === "mixed";
  const periodPurchasesReport: NavChild = {
    name: isHotelOrMixed ? "Purchases summary (bills & payments)" : "Purchases summary",
    page: "reports_daily_purchases_summary",
  };
  const purchasesByItemReport: NavChild = {
    name: isHotelOrMixed ? "Purchases report (items & departments)" : "Purchases by item",
    page: "reports_purchases_by_item",
  };

  const clinicPriorityReports: NavChild[] =
    businessType === "clinic"
      ? [
          { name: "Cash flow statement", page: "accounting_cashflow" },
          { name: "Debtors report", page: "retail_credit_invoices", state: { invoiceTab: "credit" } },
          { name: "Stock movement report", page: "reports_stock_movement" },
          { name: "Expense report", page: "reports_expenses" },
        ]
      : [];

  return [
    ...clinicPriorityReports,
    { name: "Daily summary", page: "reports_daily_summary" },
    { name: "Sales report", page: "reports_daily_sales" },
    purchasesByItemReport,
    ...(businessType === "clinic" ? [] : [periodPurchasesReport]),
    ...(businessType !== "clinic" ? [{ name: "Expense report", page: "reports_expenses" as const }] : []),
    { name: "Sales by item", page: "reports_sales_by_item" },
    { name: "Stock summary", page: "reports_stock_summary" },
    ...(businessType === "manufacturing"
      ? [{ name: "Daily production", page: "reports_manufacturing_daily_production" as const }]
      : []),
    { name: "Income statement", page: "accounting_income" },
    { name: "Balance sheet", page: "accounting_balance" },
    ...(isHotelOrMixed
      ? [
          { name: "Room billing", page: "reports_room_billing" },
          {
            name: "Debtors (invoice balances)",
            page: "retail_credit_invoices",
            state: { invoiceTab: "credit" },
          },
          { name: "Cash flow statement", page: "accounting_cashflow" },
          { name: "Stock movement", page: "reports_stock_movement" },
        ]
      : []),
  ];
}

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

  const showClinicNav = businessType === "clinic";
  const clinicNav: NavItem[] = showClinicNav
    ? [
        {
          name: "Clinic",
          icon: Stethoscope,
          children: [
            { name: "Patients", page: "clinic_patients" },
            { name: "Consultation", page: "clinic_consultation" },
            { name: "Laboratory", page: "clinic_laboratory" },
          ],
        },
      ]
    : [];

  const transactionsMoneyInLabel =
    businessType === "retail" || businessType === "clinic" ? "Other payments" : "Transactions";

  const moneyIn: NavChild[] = [
    { name: "Receive money", page: "cash_receipts" },
    { name: "Customer payments", page: "payments" },
    ...(isHotelOrMixed ? [{ name: "Guest billing", page: "billing" as const }] : []),
    { name: transactionsMoneyInLabel, page: "transactions" },
    ...(allowWallet ? [{ name: "Wallet", page: "wallet" as const }] : []),
  ];

  const moneyOut: NavChild[] = [
    { name: "Spend money", page: "purchases_expenses" },
    { name: "Pay suppliers", page: "purchases_payments" },
    /** Misc cash out / non-supplier spend — balanced GL entry (debit expense etc., credit bank/cash), not sales receipts */
    { name: "Other expenditures", page: "accounting_manual" },
  ];

  const retailSales: NavChild[] =
    businessType === "clinic"
      ? [
          { name: "POS", page: "clinic_pos" },
          { name: "Orders", page: "retail_pos_orders" },
          { name: "Invoices", page: "retail_credit_invoices" },
        ]
      : [
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
    { name: "Purchases report", page: "reports_purchases_by_item" },
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
          { name: "Customers", page: "hotel_customers" },
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
    ...clinicNav,
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
    /** No per-report sidebar links — category + report pickers live in the in-page reports hub. */
    { name: "Reports", icon: TrendingUp, page: getSimpleOrgDefaultReportRoute(businessType) },
    { name: "Settings", icon: Settings, children: settings }
  );

  return core;
}
