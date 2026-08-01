export function clearCashbookDraft(organizationId?: string | null, userId?: string | null): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(`boat.cashbook.draft.${organizationId || "no-org"}.${userId || "anonymous"}`);
  window.dispatchEvent(new CustomEvent("boat:cashbook-draft-cleared"));
}
