/** School workspace route ids — use with `?page=` and `onNavigate`. */
export const SCHOOL_PAGE = {
  dashboard: "school_dashboard",
  operations: "school_operations",
  classes: "school_classes",
  streams: "school_streams",
  subjects: "school_subjects",
  teachers: "school_teachers",
  students: "school_students",
  studentsList: "school_students_list",
  healthIssues: "school_health_issues",
  parents: "school_parents",
  feeStructures: "school_fee_structures",
  specialFeeStructures: "school_special_fee_structures",
  bursary: "school_bursary",
  invoices: "school_invoices",
  creditControl: "school_credit_control",
  collectionAutomation: "school_collection_automation",
  approvalMatrix: "school_approval_matrix",
  financeOperations: "school_finance_operations",
  payments: "school_fee_payments",
  otherRevenue: "school_other_revenue",
  rentalRegister: "school_rental_register",
  rentalPayments: "school_rental_payments",
  receipts: "school_receipts",
  collections: "school_collections_summary",
  fixedDeposit: "school_fixed_deposit",
  pettyCash: "school_petty_cash",
  scheduledConsumption: "school_scheduled_inventory_consumption",
  voteBook: "school_vote_book",
} as const;

export type SchoolPageId = (typeof SCHOOL_PAGE)[keyof typeof SCHOOL_PAGE];

export const SCHOOL_HOME_PAGE = SCHOOL_PAGE.dashboard;
