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
  | "clinic"
  | "kitchen_ops"
  | "billing"
  | "payments_received"
  | "transactions"
  | "inventory"
  | "manufacturing"
  | "purchases"
  | "reports"
  | "accounting"
  | "reconciliation"
  | "fixed_assets"
  | "asset_verification"
  | "staff"
  | "admin"
  | "sacco"
  | "school"
  | "school_fixed_deposit"
  | "vsla"
  | "payroll"
  | "budget"
  | "wallet"
  | "treasury"
  | "communications"
  | "agent"
  | "hotel_assessment";

type ModuleAudience =
  | "hotel"
  | "retail"
  /** Counter/barcode POS + orders (same surfaces as standalone retail; also for manufacturers who sell from stock). */
  | "retail_counter"
  | "both"
  /** Clinic / pharmacy workspace (hotels, retail, restaurants, mixed; not sacco/school/vsla/manufacturing). */
  | "clinic"
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
  /** Item / barcode till: retail, mixed, restaurant, and manufacturing (counter sales alongside production). */
  retail_pos: "retail_counter",
  /** Clinic / pharmacy workspace — see `isBusinessEligible` audience `"clinic"`. */
  clinic: "clinic",
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
  reconciliation: "both",
  fixed_assets: "both",
  asset_verification: "both",
  staff: "both",
  admin: "both",
  sacco: "sacco",
  school: "school",
  school_fixed_deposit: "school",
  vsla: "vsla",
  payroll: "both",
  budget: "both",
  wallet: "both",
  treasury: "both",
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
  clinic: false,
  kitchen_ops: true,
  billing: true,
  payments_received: true,
  transactions: true,
  inventory: true,
  manufacturing: true,
  purchases: true,
  reports: true,
  accounting: true,
  reconciliation: true,
  fixed_assets: true,
  asset_verification: true,
  staff: true,
  admin: true,
  sacco: true,
  school: true,
  school_fixed_deposit: true,
  vsla: true,
  payroll: true,
  budget: true,
  wallet: true,
  treasury: true,
  communications: false,
  agent: false,
  hotel_assessment: false,
};

export function isBusinessEligible(audience: ModuleAudience, businessType?: BusinessType | null): boolean {
  if (audience === "clinic") {
    return businessType === "clinic";
  }
  /** Unknown / catch-all profiles still need counter POS (`retail_counter`) and retail home; local SQLite often has null type until org row exists. */
  if (!businessType || businessType === "other") {
    return audience === "both" || audience === "retail" || audience === "retail_counter";
  }
  if (audience === "retail_counter") {
    return (
      businessType === "retail" ||
      businessType === "clinic" ||
      businessType === "mixed" ||
      businessType === "restaurant" ||
      businessType === "manufacturing"
    );
  }
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
    businessType === "mixed" || businessType === "accounting_practice" ? "both" : businessType === "restaurant" ? "retail" : businessType;
  return audience === "both" || audience === normalized;
}

export function getModuleAccess(input: {
  moduleId: ModuleId;
  businessType?: BusinessType | null;
  subscriptionStatus?: SubscriptionStatus;
  /** When not true, Fixed assets navigation is hidden (superuser-controlled per organization). */
  enableFixedAssets?: boolean;
  /** Accounting practices always have this; other organizations require the platform flag. */
  enableAssetVerification?: boolean;
  /** Platform: Communications hub. */
  enableCommunications?: boolean;
  /** Platform: Wallet module. */
  enableWallet?: boolean;
  /** Platform: Payroll module toggle. */
  enablePayroll?: boolean;
  /** Platform: Budget module toggle. */
  enableBudget?: boolean;
  /** Platform: Treasury module toggle. */
  enableTreasury?: boolean;
  /** Platform: Agent hub toggle. */
  enableAgent?: boolean;
  /** Platform: Hotel assessment & onboarding. */
  enableHotelAssessment?: boolean;
  /** Platform: Manufacturing module. */
  enableManufacturing?: boolean;
  enableReports?: boolean;
  enableAccounting?: boolean;
  /** Platform: unified cash and float reconciliation toggle. */
  enableReconciliation?: boolean;
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
    enableAssetVerification,
    enableCommunications,
    enableWallet,
    enablePayroll,
    enableBudget,
    enableTreasury,
    enableAgent,
    enableHotelAssessment,
    enableManufacturing,
    enableReports,
    enableAccounting,
    enableReconciliation,
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

  if (moduleId === "reconciliation" && enableReconciliation !== true) {
    return {
      visible: false,
      readOnly: true,
      blockedReason: "Cash and float reconciliation is not enabled for this organization. Ask a platform admin to turn it on.",
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

  if (
    moduleId === "asset_verification" &&
    businessType !== "accounting_practice" &&
    enableAssetVerification !== true
  ) {
    return {
      visible: false,
      readOnly: true,
      blockedReason: "Asset verification is not enabled for this organization. Ask a platform admin to turn it on.",
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

  if (moduleId === "treasury" && enableTreasury !== true) {
    return {
      visible: false,
      readOnly: true,
      blockedReason: "Treasury is not enabled for this organization. Ask a platform admin to turn it on.",
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
/** Manufacturing-only analytics / compliance routes */
const MANUFACTURING_ONLY_PAGE_IDS = new Set(["reports_manufacturing_daily_production"]);

const HOTEL_LODGING_ONLY_PAGE_IDS = new Set([
  "rooms",
  "reservations",
  "checkin",
  "stays",
  "housekeeping",
  "hotel_rooms_setup",
  "billing",
  "reports_room_billing",
  "hotel_assessment",
  "hotel_assessment_run",
]);

const CLINIC_PAGE_IDS = new Set([
  "clinic_dashboard",
  "clinic_patients",
  "clinic_consultation",
  "clinic_laboratory",
  "clinic_pos",
]);
const ACCOUNTING_PRACTICE_PAGE_IDS = new Set([
  "practice_dashboard",
  "practice_clients",
  "practice_engagements",
  "practice_housekeeping_audit",
  "practice_documents",
  "practice_reconciliation",
  "practice_stock_take",
  "practice_tasks",
  "practice_billing",
]);

/** True when page may be shown for `businessType` (subscription/feature gates still applied separately via getModuleAccess). */
export function isPageAllowedForBusinessType(page: string, businessType?: BusinessType | null): boolean {
  if (page === "image_document_converter") return true;
  if (page === "asset_verification") return true;
  if (ACCOUNTING_PRACTICE_PAGE_IDS.has(page)) return businessType === "accounting_practice";
  if (CLINIC_PAGE_IDS.has(page)) {
    return businessType === "clinic";
  }

  if (!businessType || businessType === "mixed") return true;

  const nonRetailLodgingProfiles: BusinessType[] = ["hotel", "school", "sacco", "vsla", "manufacturing"];
  if (nonRetailLodgingProfiles.includes(businessType) && RETAIL_EXCLUSIVE_PAGE_IDS.has(page)) {
    /** Lodging tenants use credit invoices for property customers — same page as retail debtors. */
    if (businessType === "hotel" && page === "retail_credit_invoices") {
      return true;
    }
    /** Hotel / restaurant clinic or drug-shop counter: same retail POS surfaces as mixed tenants. */
    const hotelRestaurantCounterRetail =
      (businessType === "hotel" || businessType === "restaurant") &&
      (page === "retail_pos" ||
        page === "retail_pos_orders" ||
        page === "retail_customers" ||
        page === "retail_credit_sales_report" ||
        page === "retail_credit_invoices");
    if (hotelRestaurantCounterRetail) return true;
    const manufacturingCounterPos =
      businessType === "manufacturing" &&
      (page === "retail_pos" ||
        page === "retail_pos_orders" ||
        page === "retail_customers" ||
        page === "retail_credit_invoices");
    if (!manufacturingCounterPos) return false;
  }

  if (businessType === "manufacturing" && HOTEL_EXCLUSIVE_PAGE_IDS.has(page)) return false;

  if (MANUFACTURING_ONLY_PAGE_IDS.has(page)) {
    return businessType === "manufacturing";
  }

  if (businessType === "retail") {
    if (HOTEL_EXCLUSIVE_PAGE_IDS.has(page)) return false;
    return true;
  }

  if (businessType === "restaurant") {
    if (HOTEL_LODGING_ONLY_PAGE_IDS.has(page)) return false;
    return true;
  }

  if (businessType === "clinic") {
    if (page === "retail_pos") return false;
    if (HOTEL_EXCLUSIVE_PAGE_IDS.has(page)) return false;
    return true;
  }

  return true;
}

export function pageToModuleId(page: string): ModuleId | null {
  if (page === "asset_verification") return "asset_verification";
  if (page === "image_document_converter") return null;
  if (page === "system_integrations") return null;
  if (page === "communications") return "communications";
  if (page === "agent_hub") return "agent";
  if (page === "hotel_assessment" || page === "hotel_assessment_run") return "hotel_assessment";
  if (page === SCHOOL_PAGE.fixedDeposit) return "school_fixed_deposit";
  if (SCHOOL_PAGE_VALUES.has(page)) return "school";
  if (["dashboard"].includes(page)) return "dashboard";
  if (ACCOUNTING_PRACTICE_PAGE_IDS.has(page)) return "accounting";
  if (["retail_dashboard"].includes(page)) return "retail_dashboard";
  if (["retail_credit_invoices"].includes(page)) return "retail_credit_invoices";
  if (["retail_customers", "hotel_customers", "customers"].includes(page)) return "retail_customers";
  if (["retail_credit_sales_report"].includes(page)) return "retail_credit_sales_report";
  if (["rooms", "reservations", "checkin", "stays", "housekeeping", "hotel_rooms_setup"].includes(page))
    return "frontdesk";
  if (["POS", "hotel_pos_waiter", "hotel_pos_supervisor"].includes(page)) return "hotel_pos";
  if (["retail_pos", "retail_pos_orders", "clinic_pos"].includes(page)) return "retail_pos";
  if (["clinic_dashboard", "clinic_patients", "clinic_consultation", "clinic_laboratory"].includes(page)) return "clinic";
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
    "manufacturing_price_lists",
  ].includes(page)) return "manufacturing";
  if (["purchases_vendors", "purchases_expenses", "purchases_orders", "purchases_bills", "purchases_payments", "purchases_credits", "purchases_cash_out_reconciliation"].includes(page)) return "purchases";
  if ([
    "reports",
    "reports_daily_sales",
    "reports_daily_summary",
    "reports_retail_sales_insights",
    "reports_financial_revenue_by_type",
    "reports_financial_payments_by_method",
    "reports_financial_payments_by_charge_type",
    "reports_daily_purchases_summary",
    "reports_expenses",
    "reports_purchases_by_item",
    "reports_sales_by_item",
    "reports_room_billing",
    "accounting_pos_income_reconciliation",
    "reports_stock_movement",
    "reports_stock_summary",
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
    "reports_manufacturing_daily_production",
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
  if (page === "accounting_bank_reconciliation") return "reconciliation";
  if (["accounting_budgeting", "reports_budget_variance"].includes(page)) return "budget";
  if (page === "fixed_assets") return "fixed_assets";
  if (page.startsWith("payroll_")) return "payroll";
  if (page === "wallet") return "wallet";
  if (page === "treasury") return "treasury";
  if (["staff"].includes(page)) return "staff";
  if (["admin"].includes(page)) return "admin";
  /** Explicit SACCO routes (also covered by SACCOPRO_PAGE; kept for URL/bookmark stability). */
  if (page === "sacco_members_savings_settings") return "sacco";
  if ((Object.values(SACCOPRO_PAGE) as string[]).includes(page)) return "sacco";
  if (page.startsWith("vsla_")) return "vsla";
  return null;
}
