/** School workspace route ids — use with `?page=` and `onNavigate`. */
export const SCHOOL_PAGE = {
  dashboard: "school_dashboard",
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
  payments: "school_fee_payments",
  otherRevenue: "school_other_revenue",
  receipts: "school_receipts",
  collections: "school_collections_summary",
  fixedDeposit: "school_fixed_deposit",
} as const;

export type SchoolPageId = (typeof SCHOOL_PAGE)[keyof typeof SCHOOL_PAGE];

export const SCHOOL_HOME_PAGE = SCHOOL_PAGE.dashboard;
