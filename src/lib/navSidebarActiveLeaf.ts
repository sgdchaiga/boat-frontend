import { SACCOPRO_PAGE } from "@/lib/saccoproPages";
import { HOTEL_PAGE } from "@/lib/hotelPages";

/** Active when every key in required `state` matches `pageState` (defaults: tellerDesk receive, cashbookView journal). */
export function isSidebarLeafActive(
  leaf: { page: string; state?: Record<string, unknown> },
  currentPage: string,
  pageState: Record<string, unknown>
): boolean {
  if (currentPage !== leaf.page) return false;

  if (leaf.page === SACCOPRO_PAGE.loanReports) {
    const want = (leaf.state?.loanReportTab as string | undefined) ?? "summary";
    const pv = pageState.loanReportTab as string | undefined;
    if (want === "summary") return pv === undefined || pv === null || String(pv) === "" || pv === "summary";
    return pv === want;
  }

  if (leaf.page === SACCOPRO_PAGE.loanRecovery) {
    const want = (leaf.state?.recoveryView as string | undefined) ?? "tracking";
    const pv = pageState.recoveryView as string | undefined;
    if (want === "tracking") return pv === undefined || pv === null || String(pv) === "" || pv === "tracking";
    return pv === want;
  }

  if (leaf.page === "retail_credit_invoices") {
    const want = (leaf.state?.invoiceTab as string | undefined) ?? "invoices";
    const pv = pageState.invoiceTab as string | undefined;
    if (want === "invoices") return pv === undefined || pv === null || String(pv) === "" || pv === "invoices";
    return pv === want;
  }

  if (leaf.page === HOTEL_PAGE.posWaiter || leaf.page === "POS") {
    const want = (leaf.state?.posPanel as string | undefined) ?? "tables";
    const pv = pageState.posPanel as string | undefined;
    if (want === "tables") return pv === undefined || pv === null || String(pv) === "" || pv === "tables";
    if (want === "new") return pv === "new";
    return pv === want;
  }

  if (leaf.page === "Bar Orders") {
    const want = (leaf.state?.barView as string | undefined) ?? "queue";
    const pv = pageState.barView as string | undefined;
    if (want === "queue") return pv === undefined || pv === null || String(pv) === "" || pv === "queue";
    return pv === want;
  }

  const req = leaf.state;
  if (!req || Object.keys(req).length === 0) return true;
  return Object.entries(req).every(([k, v]) => {
    const pv = pageState[k];
    const empty = pv === undefined || pv === null || String(pv) === "";
    if (empty) {
      if (k === "tellerDesk" && v === "receive") return true;
      if (k === "cashbookView" && v === "journal") return true;
    }
    return pv === v;
  });
}
