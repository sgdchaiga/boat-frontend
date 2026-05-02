/** SACCO workspace route ids — use with `?page=` and `onNavigate`. */
export const SACCOPRO_PAGE = {
  overview: "sacco_overview",
  dashboard: "sacco_dashboard",
  /** Board-friendly KPIs from workspace data. */
  performanceDashboard: "sacco_performance_dashboard",
  members: "sacco_members",
  /** Loans + savings + activity for one member. */
  memberProfile: "sacco_member_profile",
  /** Account types + account number format (rights: Admin → Approval rights). */
  savingsSettings: "sacco_members_savings_settings",
  savingsAccountOpen: "sacco_savings_open",
  /** Register of all opened savings product accounts (balances + KYC snapshot). */
  savingsAccountsList: "sacco_savings_accounts_list",
  loans: "sacco_loans",
  loanList: "sacco_loan_list",
  loanInput: "sacco_loan_input",
  loanApproval: "sacco_loan_approval",
  /** Final release of funds (board-cleared applications). */
  loanDisbursement: "sacco_loan_disbursement",
  loanDashboard: "sacco_loan_dashboard",
  loanReports: "sacco_loan_reports",
  /** Savings activity suited for reporting (same data spine as Statements; board-facing label). */
  savingsReports: "sacco_savings_reports",
  /** Hub links to Trial balance / P&L / Balance sheet — not teller-facing. */
  financialSummaries: "sacco_financial_summaries",
  loanRecovery: "sacco_loan_recovery",
  /** Reschedule, restructure, write-off & WO recovery audit. */
  loanServicing: "sacco_loan_servicing",
  loanSettings: "sacco_loan_settings",
  loanInterestCalc: "sacco_loan_interest_calc",
  savingsInterest: "sacco_savings_interest",
  /** Read-only savings movements (from workspace cashbook lines). */
  savingsStatements: "sacco_savings_statements",
  fixedDeposit: "sacco_fixed_deposit",
  clientDashboard: "sacco_client_dashboard",
  cashbook: "sacco_cashbook",
  teller: "sacco_teller",
} as const;

export type SaccoproPageId = (typeof SACCOPRO_PAGE)[keyof typeof SACCOPRO_PAGE];

/** Default landing page for `business_type === "sacco"`. */
export const SACCOPRO_HOME_PAGE = SACCOPRO_PAGE.dashboard;
