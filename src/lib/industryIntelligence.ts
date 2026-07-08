import type { BusinessType } from "@/contexts/AuthContext";

export type WorkflowStep = { title: string; page: string; note: string };
export type ReportCadence = "Daily" | "Weekly" | "Monthly";
export type RecommendedReport = { title: string; page: string; note: string; cadence: ReportCadence };

export type BusinessRecommendation = {
  id: string;
  priority: "high" | "medium" | "low";
  title: string;
  detail: string;
  page: string;
  action: string;
};

export type IntelligenceMetrics = {
  completedSteps: string[];
  productsCount: number;
  glAccountsCount: number;
  departmentsCount: number;
  payments30dCount: number;
  journalsCount: number;
  stockMovementsCount: number;
  migrationBatchesCount: number;
  costAllocationRunsCount: number;
};

export type IndustryPlaybook = {
  label: string;
  focus: string;
  workflows: WorkflowStep[];
  reports: RecommendedReport[];
  baseRecommendations: BusinessRecommendation[];
};

const sharedReports: RecommendedReport[] = [
  { title: "Income statement", page: "accounting_income", note: "Confirms revenue and expense performance.", cadence: "Monthly" },
  { title: "Balance sheet", page: "accounting_balance", note: "Confirms assets, liabilities, and equity after posting.", cadence: "Monthly" },
  { title: "Cash flow statement", page: "accounting_cashflow", note: "Shows how cash moved through operations, investing, and financing.", cadence: "Monthly" },
];

const defaultPlaybook: IndustryPlaybook = {
  label: "Business intelligence",
  focus: "Keep setup, sales, purchases, inventory, cash, accounting, and reports moving in a disciplined weekly cycle.",
  workflows: [
    { title: "Verify setup defaults", page: "admin", note: "Confirm accounts, roles, payment methods, and posting settings." },
    { title: "Maintain customers and items", page: "Products", note: "Products and contacts drive clean sales, purchases, and inventory." },
    { title: "Post purchases and sales", page: "purchases_expenses", note: "Daily posting keeps cash, stock, and payables current." },
    { title: "Review reports", page: "reports_daily_summary", note: "Use daily summary, sales, purchases, and financial reports to spot gaps." },
  ],
  reports: [
    { title: "Daily summary", page: "reports_daily_summary", note: "Operational heartbeat for daily activity.", cadence: "Daily" },
    { title: "Sales report", page: "reports_daily_sales", note: "Tracks revenue by date and period.", cadence: "Daily" },
    { title: "Stock summary", page: "reports_stock_summary", note: "Shows current inventory position.", cadence: "Weekly" },
    ...sharedReports,
  ],
  baseRecommendations: [
    {
      id: "daily_report_review",
      priority: "medium",
      title: "Review the daily summary",
      detail: "A daily report rhythm catches missing transactions before month-end.",
      page: "reports_daily_summary",
      action: "Open daily summary",
    },
  ],
};

const playbooks: Partial<Record<BusinessType, IndustryPlaybook>> = {
  manufacturing: {
    label: "Manufacturing intelligence",
    focus: "Keep raw materials, WIP, finished goods, overhead allocation, and COGS moving through a controlled production cycle.",
    workflows: [
      { title: "Maintain BOMs and price lists", page: "manufacturing_bom", note: "Standard recipes reduce costing drift before production starts." },
      { title: "Post production entries", page: "manufacturing_production_entries", note: "Issue materials, add labour and overhead, then complete finished goods." },
      { title: "Allocate overhead to batches", page: "accounting_cost_allocation", note: "Move factory costs into batch costs before margin review." },
      { title: "Review costing and production reports", page: "manufacturing_costing", note: "Compare estimated and actual production cost before pricing decisions." },
    ],
    reports: [
      { title: "Daily production", page: "reports_manufacturing_daily_production", note: "Tracks output, batch costs, and production activity.", cadence: "Daily" },
      { title: "Stock movement", page: "reports_stock_movement", note: "Confirms raw material issues and finished goods receipts.", cadence: "Weekly" },
      ...sharedReports,
    ],
    baseRecommendations: [
      {
        id: "manufacturing_overhead_allocation",
        priority: "high",
        title: "Run production overhead allocation monthly",
        detail: "Factory overhead should be allocated into production batches before management reviews margins.",
        page: "accounting_cost_allocation",
        action: "Open cost allocation",
      },
    ],
  },
  hotel: {
    label: "Hotel intelligence",
    focus: "Control reservations, check-ins, housekeeping, guest billing, restaurant POS, and cash collections as one hospitality cycle.",
    workflows: [
      { title: "Set up rooms and rates", page: "hotel_rooms_setup", note: "Room setup drives availability, billing, and occupancy reporting." },
      { title: "Manage reservations and check-ins", page: "reservations", note: "Keep front-desk activity aligned with guest balances." },
      { title: "Close guest billing and payments", page: "billing", note: "Review guest invoices before receiving payments." },
      { title: "Reconcile POS income", page: "accounting_pos_income_reconciliation", note: "Compare waiter, kitchen, bar, and room income to accounting." },
    ],
    reports: [
      { title: "Room billing", page: "reports_room_billing", note: "Shows room charges, payments, and guest balances.", cadence: "Daily" },
      { title: "POS cash collections", page: "reports_pos_cash_collections", note: "Checks collections by method and cashier.", cadence: "Daily" },
      ...sharedReports,
    ],
    baseRecommendations: [
      {
        id: "hotel_pos_income_reconciliation",
        priority: "high",
        title: "Reconcile POS and room income daily",
        detail: "Hospitality revenue comes from several desks, so daily reconciliation catches missing postings early.",
        page: "accounting_pos_income_reconciliation",
        action: "Open reconciliation",
      },
    ],
  },
  school: {
    label: "School intelligence",
    focus: "Keep student records, fee structures, invoices, collections, arrears, and management reports aligned by term.",
    workflows: [
      { title: "Maintain classes and student biodata", page: "school_students", note: "Accurate student records drive billing and collections." },
      { title: "Verify fee structures", page: "school_fee_structures", note: "Term billing depends on complete class and fee mappings." },
      { title: "Record fee payments", page: "school_fee_payments", note: "Daily posting keeps parent balances current." },
      { title: "Review defaulters", page: "reports_school_outstanding", note: "Act on arrears before the term closes." },
    ],
    reports: [
      { title: "Fee collections", page: "reports_school_fee_collections", note: "Shows fee income and payment progress.", cadence: "Daily" },
      { title: "Top defaulters", page: "reports_school_top_defaulters", note: "Highlights students or parents needing follow-up.", cadence: "Weekly" },
      { title: "Income and expenditure", page: "reports_school_income_expenditure", note: "Connects school operations to financial performance.", cadence: "Monthly" },
      ...sharedReports,
    ],
    baseRecommendations: [
      {
        id: "school_arrears_review",
        priority: "high",
        title: "Review arrears every week",
        detail: "Schools need a steady collections rhythm, especially before exams and term close.",
        page: "reports_school_top_defaulters",
        action: "Open defaulters report",
      },
    ],
  },
  clinic: {
    label: "Clinic and pharmacy intelligence",
    focus: "Control patient registration, consultation, lab orders, pharmacy stock, POS collections, debtors, and cash flow.",
    workflows: [
      { title: "Register patients", page: "clinic_patients", note: "Patient records connect consultations, lab work, invoices, and payments." },
      { title: "Record consultations and lab orders", page: "clinic_consultation", note: "Clinical services should flow into billing without duplicate entry." },
      { title: "Control pharmacy stock", page: "inventory_stock_balances", note: "Low-stock and movement reports protect medicine availability." },
      { title: "Review cash and debtors", page: "accounting_cashflow", note: "Clinics need daily cash visibility and follow-up on unpaid bills." },
    ],
    reports: [
      { title: "Clinic POS analytics", page: "reports_retail_sales_insights", note: "Shows service and pharmacy sales patterns.", cadence: "Daily" },
      { title: "Stock movement", page: "reports_stock_movement", note: "Tracks medicine issues and receipts.", cadence: "Weekly" },
      { title: "Debtors report", page: "retail_credit_invoices", note: "Shows patient or client invoice balances.", cadence: "Weekly" },
      ...sharedReports,
    ],
    baseRecommendations: [
      {
        id: "clinic_stock_review",
        priority: "high",
        title: "Review pharmacy stock weekly",
        detail: "Medicine stock-outs affect both service delivery and revenue, so stock movements need regular review.",
        page: "reports_stock_movement",
        action: "Open stock movement",
      },
    ],
  },
  sacco: {
    label: "SACCO intelligence",
    focus: "Control member onboarding, teller transactions, savings, loans, arrears, cashbook, and financial summaries.",
    workflows: [
      { title: "Maintain member register", page: "sacco_members", note: "Every teller, savings, and loan transaction starts with a clean member record." },
      { title: "Post teller transactions", page: "sacco_teller", note: "Receive money, give money, and transfers should be posted daily." },
      { title: "Review loan portfolio", page: "sacco_loan_dashboard", note: "Monitor applications, disbursements, repayments, and arrears." },
      { title: "Close cashbook and summaries", page: "sacco_cashbook", note: "Cashbook review supports regulatory and board reporting." },
    ],
    reports: [
      { title: "Financial summaries", page: "sacco_financial_summaries", note: "Board-ready financial summary by period.", cadence: "Monthly" },
      { title: "Loan reports", page: "sacco_loan_reports", note: "Tracks portfolio, aging, and collections.", cadence: "Weekly" },
      { title: "Savings reports", page: "sacco_savings_reports", note: "Shows member savings balances and movements.", cadence: "Weekly" },
    ],
    baseRecommendations: [
      {
        id: "sacco_arrears_followup",
        priority: "high",
        title: "Review overdue loans weekly",
        detail: "Regular arrears review protects portfolio quality and cash flow.",
        page: "sacco_loan_recovery",
        action: "Open overdue loans",
      },
    ],
  },
  vsla: {
    label: "VSLA intelligence",
    focus: "Keep member register, meetings, savings, loans, repayments, cashbox, fines, and share-out controlled.",
    workflows: [
      { title: "Maintain member register", page: "vsla_members", note: "Member records support savings, fines, loans, and share-out." },
      { title: "Run meeting workflow", page: "vsla_meetings", note: "Attendance, savings, loans, and repayments should be captured together." },
      { title: "Review cashbox", page: "vsla_cashbox", note: "Cashbox visibility protects group accountability." },
      { title: "Prepare share-out", page: "vsla_share_out", note: "Share-out depends on clean savings, fines, and loan balances." },
    ],
    reports: [
      { title: "VSLA reports", page: "vsla_reports", note: "Group reporting for balances and activity.", cadence: "Weekly" },
      { title: "Member statement", page: "vsla_member_statement", note: "Individual member movement and balance review.", cadence: "Monthly" },
      { title: "Controls and audit", page: "vsla_controls", note: "Checks governance and meeting controls.", cadence: "Monthly" },
    ],
    baseRecommendations: [
      {
        id: "vsla_meeting_controls",
        priority: "high",
        title: "Review controls after each meeting",
        detail: "Meeting-based groups need quick checks for attendance, savings, loan, and cashbox completeness.",
        page: "vsla_controls",
        action: "Open controls",
      },
    ],
  },
};

export function getIndustryPlaybook(businessType: BusinessType | null | undefined): IndustryPlaybook {
  return (businessType && playbooks[businessType]) || defaultPlaybook;
}

export function buildBusinessRecommendations(
  businessType: BusinessType | null | undefined,
  metrics: IntelligenceMetrics
): BusinessRecommendation[] {
  const recommendations: BusinessRecommendation[] = [...getIndustryPlaybook(businessType).baseRecommendations];
  const completed = new Set(metrics.completedSteps);

  if (!completed.has("verify_defaults") || metrics.glAccountsCount === 0) {
    recommendations.push({
      id: "verify_template_defaults",
      priority: "high",
      title: "Verify generated setup defaults",
      detail: "Chart of accounts, journal settings, departments, roles, and business settings should be verified before heavy transaction entry.",
      page: "admin",
      action: "Open settings",
    });
  }

  if (metrics.migrationBatchesCount === 0 && !completed.has("import_data")) {
    recommendations.push({
      id: "import_opening_data",
      priority: "medium",
      title: "Import opening data or confirm none is needed",
      detail: "Existing customers, suppliers, items, stock counts, and opening balances help reports make sense from day one.",
      page: "data_migration",
      action: "Open data migration",
    });
  }

  if (metrics.productsCount === 0) {
    recommendations.push({
      id: "create_first_item",
      priority: "high",
      title: "Create the first item or service",
      detail: "Transactions and reports need at least one product, service, fee, recipe, or item.",
      page: businessType === "manufacturing" ? "manufacturing_bom" : "Products",
      action: "Create item",
    });
  }

  if (metrics.payments30dCount === 0 && metrics.journalsCount === 0) {
    recommendations.push({
      id: "record_first_transaction",
      priority: "high",
      title: "Record the first live transaction",
      detail: "A first posted sale, receipt, purchase, or journal proves the workspace is ready for daily use.",
      page: businessType === "manufacturing" ? "manufacturing_production_entries" : "purchases_expenses",
      action: "Start transaction",
    });
  }

  if (metrics.stockMovementsCount === 0 && ["retail", "restaurant", "hotel", "mixed", "clinic", "manufacturing", "agriculture"].includes(String(businessType))) {
    recommendations.push({
      id: "confirm_stock_movement",
      priority: "medium",
      title: "Confirm inventory movement is working",
      detail: "Stock reports become useful after opening stock, purchases, adjustments, or production receipts are posted.",
      page: "inventory_stock_balances",
      action: "Open stock levels",
    });
  }

  if (metrics.costAllocationRunsCount === 0 && ["manufacturing", "hotel", "mixed", "clinic", "school"].includes(String(businessType))) {
    recommendations.push({
      id: "configure_cost_allocation",
      priority: businessType === "manufacturing" ? "high" : "medium",
      title: "Set up cost allocation rhythm",
      detail: "Shared costs like rent, utilities, support departments, and factory overhead should be allocated consistently.",
      page: "accounting_cost_allocation",
      action: "Open cost allocation",
    });
  }

  recommendations.push({
    id: "review_auto_reports",
    priority: "low",
    title: "Review recommended reports",
    detail: "Use the industry report list on this page as the standard weekly and monthly management pack.",
    page: businessType === "manufacturing" ? "reports_manufacturing_daily_production" : "reports_daily_summary",
    action: "Open report",
  });

  return recommendations.filter((rec, index, all) => all.findIndex((item) => item.id === rec.id) === index);
}
