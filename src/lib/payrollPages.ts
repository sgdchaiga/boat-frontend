/** Payroll workspace route ids — use with `?page=` and `onNavigate`. */
export const PAYROLL_PAGE = {
  hub: "payroll_hub",
  staff: "payroll_staff",
  settings: "payroll_settings",
  loans: "payroll_loans",
  periods: "payroll_periods",
  run: "payroll_run",
  audit: "payroll_audit",
  /** Deep link: use with payrollRunId + payrollStaffId in URL state */
  payslip: "payroll_payslip",
} as const;

export type PayrollPageId = (typeof PAYROLL_PAGE)[keyof typeof PAYROLL_PAGE];

export const PAYROLL_HOME_PAGE = PAYROLL_PAGE.hub;
