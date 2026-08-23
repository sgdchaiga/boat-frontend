export type ReconciliationWorkMode = "individual" | "collaborative";
export type ReconciliationStatus = "draft" | "cashbook_ready" | "statement_verified" | "exceptions_resolved" | "ready_for_review" | "approved";
export type CollaboratorRole = "cashbook_owner" | "statement_owner" | "reviewer";

export const RECONCILIATION_STATUS_LABELS: Record<ReconciliationStatus, string> = {
  draft: "Draft",
  cashbook_ready: "Cashbook ready",
  statement_verified: "Statement verified",
  exceptions_resolved: "Exceptions resolved",
  ready_for_review: "Ready for review",
  approved: "Approved / closed",
};

export function reconciliationProgress(input: { totalLines: number; matchedLines: number; openExceptions: number }) {
  const percentage = input.totalLines ? Math.round((input.matchedLines / input.totalLines) * 100) : 0;
  return { percentage, exceptionCount: input.openExceptions };
}

export function nextReconciliationStatus(cashbookReady: boolean, statementVerified: boolean, openExceptions: number): ReconciliationStatus {
  if (cashbookReady && statementVerified && openExceptions === 0) return "ready_for_review";
  if (cashbookReady && statementVerified) return "statement_verified";
  if (statementVerified) return "statement_verified";
  if (cashbookReady) return "cashbook_ready";
  return "draft";
}
