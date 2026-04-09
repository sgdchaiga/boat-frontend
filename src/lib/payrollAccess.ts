import { canApprove } from "@/lib/approvalRights";

export type PayrollAccessResult = {
  /** Prepare run, calculate payslips, edit absence days, staff pay, loans, periods, settings. */
  canPrepare: boolean;
  /** Approve payroll for payment (required before posting to the ledger). */
  canApproveForPayment: boolean;
  /** Post journal entry to the GL. */
  canPostToLedger: boolean;
  /** View audit log (always true when module is not subscription read-only). */
  canViewAudit: boolean;
};

export function getPayrollAccess(role: string | undefined, readOnly: boolean): PayrollAccessResult {
  if (readOnly) {
    return {
      canPrepare: false,
      canApproveForPayment: false,
      canPostToLedger: false,
      canViewAudit: true,
    };
  }
  const r = role ?? "";
  return {
    canPrepare: canApprove("payroll_prepare", r),
    canApproveForPayment: canApprove("payroll_approve", r),
    canPostToLedger: canApprove("payroll_post", r),
    canViewAudit: true,
  };
}
