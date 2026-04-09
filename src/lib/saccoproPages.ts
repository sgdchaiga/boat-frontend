/** SACCO workspace route ids — use with `?page=` and `onNavigate`. */
export const SACCOPRO_PAGE = {
  overview: "sacco_overview",
  dashboard: "sacco_dashboard",
  members: "sacco_members",
  /** Account types + account number format (rights: Admin → Approval rights). */
  savingsSettings: "sacco_members_savings_settings",
  savingsAccountOpen: "sacco_savings_open",
  /** Register of all opened savings product accounts (balances + KYC snapshot). */
  savingsAccountsList: "sacco_savings_accounts_list",
  loans: "sacco_loans",
  loanList: "sacco_loan_list",
  loanInput: "sacco_loan_input",
  loanApproval: "sacco_loan_approval",
  loanDashboard: "sacco_loan_dashboard",
  loanReports: "sacco_loan_reports",
  loanRecovery: "sacco_loan_recovery",
  loanSettings: "sacco_loan_settings",
  loanInterestCalc: "sacco_loan_interest_calc",
  savingsInterest: "sacco_savings_interest",
  fixedDeposit: "sacco_fixed_deposit",
  clientDashboard: "sacco_client_dashboard",
  cashbook: "sacco_cashbook",
  teller: "sacco_teller",
} as const;

export type SaccoproPageId = (typeof SACCOPRO_PAGE)[keyof typeof SACCOPRO_PAGE];

/** Default landing page for `business_type === "sacco"`. */
export const SACCOPRO_HOME_PAGE = SACCOPRO_PAGE.dashboard;
