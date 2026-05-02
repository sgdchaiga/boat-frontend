import type { BusinessType, SubscriptionStatus } from "@/contexts/AuthContext";
import { SACCOPRO_PAGE } from "@/lib/saccoproPages";
import { SCHOOL_PAGE } from "@/lib/schoolPages";

export type ModuleId =
  | "dashboard"
  | "retail_dashboard"
  | "retail_credit_invoices"
  | "retail_customers"
  | "retail_credit_sales_report"
  | "frontdesk"
  | "hotel_pos"
  | "retail_pos"
  | "kitchen_ops"
  | "billing"
  | "payments_received"
  | "transactions"
  | "inventory"
  | "manufacturing"
  | "purchases"
  | "reports"
  | "accounting"
  | "fixed_assets"
  | "staff"
  | "admin"
  | "sacco"
  | "school"
  | "school_fixed_deposit"
  | "vsla"
  | "payroll"
  | "budget"
  | "wallet"
  | "communications"
  | "agent"
  | "hotel_assessment";

type ModuleAudience =
  | "hotel"
  | "retail"
  | "both"
  | "sacco"
  | "school"
  | "manufacturing"
  | "production"
  | "vsla";

export interface ModuleAccess {
  visible: boolean;
  readOnly: boolean;
  blockedReason?: string;
}

const ACTIVE_STATUSES: SubscriptionStatus[] = ["active", "trial"];

const MODULE_AUDIENCE: Record<ModuleId, ModuleAudience> = {
  dashboard: "hotel",
  retail_dashboard: "retail",
  retail_credit_invoices: "both",
  retail_customers: "both",
  retail_credit_sales_report: "both",
  frontdesk: "hotel",
  hotel_pos: "hotel",
  /** Item / barcode till for standalone retail tenants; hotels use waiter POS (`hotel_pos` module routes). Mixed orgs get both hospitality + retail modules. */
  retail_pos: "retail",
  kitchen_ops: "hotel",
  billing: "hotel",
  payments_received: "both",
  transactions: "both",
  inventory: "both",
  /** Hotels, restaurants, mixed, and dedicated manufacturers (not pure retail-only). */
  manufacturing: "production",
  purchases: "both",
  reports: "both",
  accounting: "both",
  fixed_assets: "both",
  staff: "both",
  admin: "both",
  sacco: "sacco",
  school: "school",
  school_fixed_deposit: "school",
  vsla: "vsla",
  payroll: "both",
  budget: "both",
  wallet: "both",
  communications: "both",
  agent: "both",
  hotel_assessment: "hotel",
};

const MODULE_REQUIRES_SUBSCRIPTION: Record<ModuleId, boolean> = {
  dashboard: false,
  retail_dashboard: false,
  retail_credit_invoices: true,
  retail_customers: true,
  retail_credit_sales_report: true,
  frontdesk: true,
  hotel_pos: true,
  retail_pos: true,
  kitchen_ops: true,
  billing: true,
  payments_received: true,
  transactions: true,
  inventory: true,
  manufacturing: true,
  purchases: true,
  reports: true,
  accounting: true,
  fixed_assets: true,
  staff: true,
  admin: true,
  sacco: true,
  school: true,
  school_fixed_deposit: true,
  vsla: true,
  payroll: true,
  budget: true,
  wallet: true,
  communications: false,
  agent: false,
  hotel_assessment: false,
};

export function isBusinessEligible(audience: ModuleAudience, businessType?: BusinessType | null): boolean {
  if (!businessType || businessType === "other") return audience === "both";
  if (audience === "production") {
    return (
      businessType === "hotel" ||
      businessType === "mixed" ||
      businessType === "restaurant" ||
      businessType === "manufacturing"
    );
  }
  if (audience === "manufacturing") return businessType === "manufacturing";
  if (audience === "vsla") return businessType === "vsla";
  if (audience === "school") return businessType === "school";
  if (businessType === "school") return audience === "both";
  if (audience === "sacco") return businessType === "sacco";
  if (businessType === "sacco") return audience === "both";
  if (businessType === "mixed" && audience === "hotel") return true;
  /** Lodging-plus-retail tenants use both waiter POS surfaces and retail counter routes. */
  if (businessType === "mixed" && audience === "retail") return true;
  const normalized: ModuleAudience =
    businessType === "mixed" ? "both" : businessType === "restaurant" ? "retail" : businessType;
  return audience === "both" || audience === normalized;
}

export function getModuleAccess(input: {
  moduleId: ModuleId;
  businessType?: BusinessType | null;
  subscriptionStatus?: SubscriptionStatus;
  /** When not true, Fixed assets navigation is hidden (superuser-controlled per organization). */
  enableFixedAssets?: boolean;
  /** Platform: Communications hub. */
  enableCommunications?: boolean;
  /** Platform: Wallet module. */
  enableWallet?: boolean;
  /** Platform: Payroll module toggle. */
  enablePayroll?: boolean;
  /** Platform: Budget module toggle. */
  enableBudget?: boolean;
  /** Platform: Agent hub toggle. */
  enableAgent?: boolean;
  /** Platform: Hotel assessment & onboarding. */
  enableHotelAssessment?: boolean;
  /** Platform: Manufacturing module. */
  enableManufacturing?: boolean;
  enableReports?: boolean;
  enableAccounting?: boolean;
  enableInventory?: boolean;
  enablePurchases?: boolean;
  /** School org: superuser toggles for BOAT-linked areas (ignored for non-school). */
  schoolEnableReports?: boolean;
  schoolEnableFixedDeposit?: boolean;
  schoolEnableAccounting?: boolean;
  schoolEnableInventory?: boolean;
  schoolEnablePurchases?: boolean;
}): ModuleAccess {
  const {
    moduleId,
    businessType,
    subscriptionStatus = "none",
    enableFixedAssets,
    enableCommunications,
    enableWallet,
    enablePayroll,
    enableBudget,
    enableAgent,
    enableHotelAssessment,
    enableManufacturing,
    enableReports,
    enableAccounting,
    enableInventory,
    enablePurchases,
    schoolEnableReports,
    schoolEnableFixedDeposit,
    schoolEnableAccounting,
    schoolEnableInventory,
    schoolEnablePurchases,
  } = input;
  const audience = MODULE_AUDIENCE[moduleId];
  if (!isBusinessEligible(audience, businessType)) {
    return { visible: false, readOnly: true, blockedReason: "Module not available for your business type." };
  }

  if (businessType === "school") {
    if (moduleId === "reports" && schoolEnableReports !== true) {
      return {
        visible: false,
        readOnly: true,
        blockedReason: "Reports are not enabled for this school. Ask a platform admin to turn them on.",
      };
    }
    if (moduleId === "accounting" && schoolEnableAccounting !== true) {
      return {
        visible: false,
        readOnly: true,
        blockedReason: "Accounting is not enabled for this school. Ask a platform admin to turn it on.",
      };
    }
    if (moduleId === "inventory" && schoolEnableInventory !== true) {
      return {
        visible: false,
        readOnly: true,
        blockedReason: "Inventory is not enabled for this school. Ask a platform admin to turn it on.",
      };
    }
    if (moduleId === "purchases" && schoolEnablePurchases !== true) {
      return {
        visible: false,
        readOnly: true,
        blockedReason: "Purchases are not enabled for this school. Ask a platform admin to turn them on.",
      };
    }
    if (moduleId === "school_fixed_deposit" && schoolEnableFixedDeposit !== true) {
      return {
        visible: false,
        readOnly: true,
        blockedReason: "Fixed deposits are not enabled for this school. Ask a platform admin to turn them on.",
      };
    }
  }

  if (moduleId === "reports" && enableReports !== true) {
    return {
      visible: false,
      readOnly: true,
      blockedReason: "Reports are not enabled for this organization. Ask a platform admin to turn them on.",
    };
  }

  if (moduleId === "accounting" && enableAccounting !== true) {
    return {
      visible: false,
      readOnly: true,
      blockedReason: "Accounting is not enabled for this organization. Ask a platform admin to turn it on.",
    };
  }

  if (moduleId === "inventory" && enableInventory !== true) {
    return {
      visible: false,
      readOnly: true,
      blockedReason: "Inventory is not enabled for this organization. Ask a platform admin to turn it on.",
    };
  }

  if (moduleId === "purchases" && enablePurchases !== true) {
    return {
      visible: false,
      readOnly: true,
      blockedReason: "Purchases are not enabled for this organization. Ask a platform admin to turn it on.",
    };
  }

  if (moduleId === "fixed_assets" && enableFixedAssets !== true) {
    return {
      visible: false,
      readOnly: true,
      blockedReason: "Fixed assets is not enabled for this business. Ask a platform admin to turn it on.",
    };
  }

  if (moduleId === "communications" && enableCommunications !== true) {
    return {
      visible: false,
      readOnly: true,
      blockedReason: "Communications is not enabled for this organization. Ask a platform admin to turn it on.",
    };
  }

  if (moduleId === "wallet" && enableWallet !== true) {
    return {
      visible: false,
      readOnly: true,
      blockedReason: "Wallet is not enabled for this organization. Ask a platform admin to turn it on.",
    };
  }

  if (moduleId === "payroll" && enablePayroll !== true) {
    return {
      visible: false,
      readOnly: true,
      blockedReason: "Payroll is not enabled for this organization. Ask a platform admin to turn it on.",
    };
  }

  if (moduleId === "budget" && enableBudget !== true) {
    return {
      visible: false,
      readOnly: true,
      blockedReason: "Budget is not enabled for this organization. Ask a platform admin to turn it on.",
    };
  }

  if (moduleId === "agent" && enableAgent !== true) {
    return {
      visible: false,
      readOnly: true,
      blockedReason: "Agent Hub is not enabled for this organization.",
    };
  }

  if (moduleId === "hotel_assessment" && enableHotelAssessment !== true) {
    return {
      visible: false,
      readOnly: true,
      blockedReason:
        "Assessment & onboarding is not enabled for this organization. Ask a platform admin to turn it on.",
    };
  }

  if (moduleId === "manufacturing" && enableManufacturing !== true) {
    return {
      visible: false,
      readOnly: true,
      blockedReason:
        "Manufacturing is not enabled for this organization. Ask a platform admin to turn it on.",
    };
  }

  if (!MODULE_REQUIRES_SUBSCRIPTION[moduleId]) {
    return { visible: true, readOnly: false };
  }

  if (ACTIVE_STATUSES.includes(subscriptionStatus)) {
    return { visible: true, readOnly: false };
  }

  return {
    visible: true,
    readOnly: true,
    blockedReason: "Subscription inactive. Read-only mode is enabled.",
  };
}

const SCHOOL_PAGE_VALUES = new Set(Object.values(SCHOOL_PAGE) as string[]);

/**
 * Routes for shop / retail-counter workflows (standalone POS, debtor retail, retail analytics).
 * Hidden for lodging-only and other non–shop-first org profiles so sidebar and deep links stay aligned.
 */
const RETAIL_EXCLUSIVE_PAGE_IDS = new Set([
  "retail_dashboard",
  "retail_pos",
  "retail_pos_orders",
  "retail_credit_invoices",
  "retail_credit_sales_report",
  "retail_customers",
  "reports_retail_sales_insights",
  "reports_retail_shift_variance",
]);

/** Lodging front office + hotel/restaurant POS surface + guest-facing hotel assessment. */
const HOTEL_EXCLUSIVE_PAGE_IDS = new Set([
  "rooms",
  "reservations",
  "checkin",
  "stays",
  "housekeeping",
  "hotel_rooms_setup",
  "billing",
  "hotel_pos_waiter",
  "hotel_pos_kitchen_bar",
  "hotel_pos_supervisor",
  "hotel_pos_reports",
  "kitchen_display",
  "Kitchen Orders",
  "Bar Orders",
  "kitchen_menu",
  "hotel_assessment",
  "hotel_assessment_run",
  "hotel_customers",
]);

/** Rooms & stay ops only (kitchen / bar POS still allowed). */
const HOTEL_LODGING_ONLY_PAGE_IDS = new Set([
  "rooms",
  "reservations",
  "checkin",
  "stays",
  "housekeeping",
  "hotel_rooms_setup",
  "billing",
  "hotel_assessment",
  "hotel_assessment_run",
]);

/** True when page may be shown for `businessType` (subscription/feature gates still applied separately via getModuleAccess). */
export function isPageAllowedForBusinessType(page: string, businessType?: BusinessType | null): boolean {
  if (!businessType || businessType === "mixed") return true;

  const nonRetailLodgingProfiles: BusinessType[] = ["hotel", "school", "sacco", "vsla", "manufacturing"];
  if (nonRetailLodgingProfiles.includes(businessType) && RETAIL_EXCLUSIVE_PAGE_IDS.has(page)) return false;

  if (businessType === "manufacturing" && HOTEL_EXCLUSIVE_PAGE_IDS.has(page)) return false;

  if (businessType === "retail") {
    if (HOTEL_EXCLUSIVE_PAGE_IDS.has(page)) return false;
    return true;
  }

  if (businessType === "restaurant") {
    if (HOTEL_LODGING_ONLY_PAGE_IDS.has(page)) return false;
    return true;
  }

  return true;
}

export function pageToModuleId(page: string): ModuleId | null {
  if (page === "system_integrations") return null;
  if (page === "communications") return "communications";
  if (page === "agent_hub") return "agent";
  if (page === "hotel_assessment" || page === "hotel_assessment_run") return "hotel_assessment";
  if (page === SCHOOL_PAGE.fixedDeposit) return "school_fixed_deposit";
  if (SCHOOL_PAGE_VALUES.has(page)) return "school";
  if (["dashboard"].includes(page)) return "dashboard";
  if (["retail_dashboard"].includes(page)) return "retail_dashboard";
  if (["retail_credit_invoices"].includes(page)) return "retail_credit_invoices";
  if (["retail_customers", "hotel_customers", "customers"].includes(page)) return "retail_customers";
  if (["retail_credit_sales_report"].includes(page)) return "retail_credit_sales_report";
  if (["rooms", "reservations", "checkin", "stays", "housekeeping", "hotel_rooms_setup"].includes(page))
    return "frontdesk";
  if (["POS", "hotel_pos_waiter", "hotel_pos_supervisor"].includes(page)) return "hotel_pos";
  if (["retail_pos", "retail_pos_orders"].includes(page)) return "retail_pos";
  if (["kitchen_display", "Kitchen Orders", "Bar Orders", "kitchen_menu", "hotel_pos_kitchen_bar"].includes(page)) return "kitchen_ops";
  if (page === "billing") return "billing";
  if (page === "payments" || page === "cash_receipts") return "payments_received";
  if (["transactions"].includes(page)) return "transactions";
  if (["Products", "inventory_barcodes", "inventory_stock_adjustments", "inventory_store_requisitions", "inventory_stock_balances"].includes(page)) return "inventory";
  if ([
    "manufacturing",
    "manufacturing_bom",
    "manufacturing_work_orders",
    "manufacturing_production_entries",
    "manufacturing_costing",
  ].includes(page)) return "manufacturing";
  if (["purchases_vendors", "purchases_expenses", "purchases_orders", "purchases_bills", "purchases_payments", "purchases_credits"].includes(page)) return "purchases";
  if ([
    "reports",
    "reports_daily_sales",
    "reports_daily_summary",
    "reports_retail_sales_insights",
    "reports_financial_revenue_by_type",
    "reports_financial_payments_by_method",
    "reports_financial_payments_by_charge_type",
    "reports_daily_purchases_summary",
    "reports_purchases_by_item",
    "reports_sales_by_item",
    "reports_stock_movement",
    "reports_school_fee_collections",
    "reports_school_outstanding",
    "reports_school_enrollment",
    "reports_school_daily_cash",
    "reports_school_income_expenditure",
    "reports_school_fee_trends",
    "reports_school_top_defaulters",
    "reports_school_term_performance",
    "hotel_pos_reports",
    "reports_retail_shift_variance",
  ].includes(page)) return "reports";
  if ([
    "gl_accounts",
    "accounting_journal",
    "accounting_manual",
    "accounting_gl",
    "accounting_trial",
    "accounting_income",
    "accounting_balance",
    "accounting_cashflow",
  ].includes(page)) return "accounting";
  if (["accounting_budgeting", "reports_budget_variance"].includes(page)) return "budget";
  if (page === "fixed_assets") return "fixed_assets";
  if (page.startsWith("payroll_")) return "payroll";
  if (page === "wallet") return "wallet";
  if (["staff"].includes(page)) return "staff";
  if (["admin"].includes(page)) return "admin";
  /** Explicit SACCO routes (also covered by SACCOPRO_PAGE; kept for URL/bookmark stability). */
  if (page === "sacco_members_savings_settings") return "sacco";
  if ((Object.values(SACCOPRO_PAGE) as string[]).includes(page)) return "sacco";
  if (page.startsWith("vsla_")) return "vsla";
  return null;
}
