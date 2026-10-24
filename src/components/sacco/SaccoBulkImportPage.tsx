import { useCallback, useMemo, useState } from "react";
import { Download, FileUp, Loader2, Upload } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAppContext } from "@/contexts/AppContext";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";
import { PageNotes } from "@/components/common/PageNotes";
import { canEditSaccoSavingsSettings, isLocalAuthEnvEnabled } from "@/lib/saccoSavingsSettingsAccess";
import {
  applyMemberProfilePlans,
  applySavingsBalancePlans,
  downloadSaccoBulkImportTemplate,
  downloadSaccoMigrationWorkbook,
  loadSaccoBulkImportContext,
  parseBulkImportFile,
  planMemberProfileImports,
  planSavingsBalanceImports,
  type SaccoBulkImportKind,
  type SaccoBulkImportPreviewRow,
} from "@/lib/saccoBulkImport";
import {
  applyLoanProductsImport,
  canBulkImportSaccoLoanProducts,
  downloadLoanProductsBulkTemplate,
  planLoanProductImports,
} from "@/lib/saccoLoanProductsBulk";
import { fetchLoansForOrganization } from "@/lib/saccoDb";
import {
  applyMemberLoansPortfolioPlans,
  downloadMemberLoansPortfolioTemplate,
  getLoanImportDisbursementDate,
  parseIsoDateOnly,
  planMemberLoansPortfolioImport,
} from "@/lib/saccoMemberLoansBulkImport";
import { applyHistoricalCashbookPlans, loadHistoricalImportContext, planHistoricalCashbookRows } from "@/lib/saccoHistoricalCashbookImport";
import { supabase } from "@/lib/supabase";

const IMPORT_OPTIONS: Array<{ id: SaccoBulkImportKind; label: string; description: string }> = [
  {
    id: "historical_cashbook",
    label: "Historical cashbook",
    description: "Import deposits, withdrawals, shares, charges, fees and loan repayments from the legacy cashbook. Preview matches members, accounts and loans and blocks duplicates before posting.",
  },
  {
    id: "savings_balances",
    label: "Savings account balances",
    description:
      "Update balance and/or savings product code on existing accounts. Match by member_number + account_number, or member_number + current savings_product_code (and optional sub_account). Use column new_savings_product_code to rename the product; leave balance blank to keep the current amount.",
  },
  {
    id: "member_profile",
    label: "Member profile",
    description:
      "Update register fields (name, phone, KYC, register savings/shares columns). Only non-empty columns in the file are changed.",
  },
  {
    id: "loan_products",
    label: "Loan products (rates & fees)",
    description:
      "Create or update loan products by name. Rows in the file replace fields for matched products or add new ones. Products not listed in the file are left unchanged.",
  },
  {
    id: "member_loans",
    label: "Loan portfolio & disbursements",
    description:
      "Create or update member loans, including the legacy loan-approval sheet. It recognizes Date, Client Name., Loan Amount, Loan Type, Code, Period, Loan No., Net Amount, Application/Loan Form, Processing Fee and Insurance.",
  },
];

type SaccoBulkImportPageProps = {
  readOnly?: boolean;
  /** When set, hides import-type tiles and fixes the flow (Loans hub shortcuts). */
  lockedKind?: SaccoBulkImportKind;
  /** Uses Cashbook language and keeps the operator in the Cashbook workflow. */
  cashbookMode?: boolean;
};

export function SaccoBulkImportPage({
  readOnly: subscriptionReadOnly = false,
  lockedKind,
  cashbookMode = false,
}: SaccoBulkImportPageProps) {
  const { user, isSuperAdmin } = useAuth();
  const { refreshSaccoWorkspace, loanProducts } = useAppContext();
  const orgId = user?.organization_id ?? null;

  const canSavingsKinds =
    canEditSaccoSavingsSettings(user?.role, {
      isSuperAdmin: Boolean(isSuperAdmin),
      localAuthEnabled: isLocalAuthEnvEnabled(),
    }) && !subscriptionReadOnly;

  const canLoanImport = canBulkImportSaccoLoanProducts(user?.role, { isSuperAdmin: Boolean(isSuperAdmin) }) && !subscriptionReadOnly;
  const canHistoricalCashbookImport = Boolean(isSuperAdmin || user?.isSuperAdmin || ["admin", "manager", "accountant", "super_admin"].includes(String(user?.role ?? "").toLowerCase())) && !subscriptionReadOnly;

  const [kindUnlocked, setKindUnlocked] = useState<SaccoBulkImportKind>("savings_balances");
  const kind = lockedKind ?? kindUnlocked;
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<SaccoBulkImportPreviewRow[] | null>(null);
  const [previewFilter, setPreviewFilter] = useState<"errors" | "ok" | "all">("all");
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<{ completed: number; total: number; imported: number; failed: number } | null>(null);
  const [portfolioAsOfDate, setPortfolioAsOfDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [savingsBalanceAsAt, setSavingsBalanceAsAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [cashbookDefaultEffectiveDate, setCashbookDefaultEffectiveDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [openingJournalDate, setOpeningJournalDate] = useState("2025-12-31");
  const [postingOpeningJournal, setPostingOpeningJournal] = useState(false);
  const [disbursementFrom, setDisbursementFrom] = useState("");
  const [disbursementTo, setDisbursementTo] = useState("");

  const selected = useMemo(() => IMPORT_OPTIONS.find((o) => o.id === kind) ?? IMPORT_OPTIONS[0], [kind]);

  const canOperate = kind === "historical_cashbook"
    ? canHistoricalCashbookImport
    : kind === "loan_products" || kind === "member_loans" ? canLoanImport : canSavingsKinds;

  const restrictionMessage =
    kind === "historical_cashbook"
      ? "This cashbook upload requires Accountant, Manager, Admin, or Super Admin role."
      : kind === "loan_products" || kind === "member_loans"
      ? "This loan import requires Super Admin or organization Admin role."
      : "Your role cannot run this import. Grant “Savings settings” under Permissions (admin/manager when enabled).";

  const resetPreview = () => {
    setPreview(null);
    setPreviewFilter("all");
    setResultMessage(null);
    setError(null);
    setImportProgress(null);
  };

  const postSavingsOpeningJournal = async () => {
    if (!canOperate || postingOpeningJournal) return;
    if (!parseIsoDateOnly(openingJournalDate)) { setError("Set a valid opening-balance as-at date."); return; }
    if (!confirm(`Post the member savings opening journal as at ${openingJournalDate}?\n\nDebit 8040 Opening Balance Clearing Account. Credit products 11–14 to 21011, 21012, 21013 and 21014. This is a posted accounting entry.`)) return;
    setPostingOpeningJournal(true); setError(null); setResultMessage(null);
    try {
      const { data, error: rpcError } = await supabase.rpc("post_sacco_savings_opening_balances", { p_as_at_date: openingJournalDate });
      if (rpcError) throw new Error(rpcError.message);
      setResultMessage(`Opening savings journal posted for ${openingJournalDate}. Journal ${String(data).slice(0, 8)} is now included in the Balance Sheet.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not post the opening savings journal.");
    } finally { setPostingOpeningJournal(false); }
  };

  const runPreview = useCallback(async () => {
    if (!orgId || !file) return;
    setLoading(true);
    setError(null);
    setResultMessage(null);
    try {
      const { rows } = await parseBulkImportFile(file);
      if (rows.length === 0) {
        setError("File has no data rows (need a header row plus at least one row).");
        setPreview(null);
        return;
      }

      let plannedPreview: SaccoBulkImportPreviewRow[];

      if (kind === "historical_cashbook") {
        if (!parseIsoDateOnly(cashbookDefaultEffectiveDate)) {
          setError("Set a valid default effective date (YYYY-MM-DD).");
          setPreview(null);
          return;
        }
        const ctx = await loadHistoricalImportContext(orgId);
        plannedPreview = planHistoricalCashbookRows(ctx, rows, cashbookDefaultEffectiveDate);
        setPreview(plannedPreview);
        const bad = plannedPreview.filter((r) => r.status === "error").length;
        setPreviewFilter(bad ? "errors" : "ok");
        const ok = plannedPreview.filter((r) => r.status === "ok").length;
        const skip = plannedPreview.filter((r) => r.status === "skip").length;
        if (bad) setError(`${bad} row(s) need attention. Nothing can be posted until errors are fixed.`);
        else if (!ok) setError(skip ? "All rows were already imported." : "No rows ready to import.");
        else setResultMessage(`Ready: ${ok} historical transaction(s)${skip ? `, ${skip} duplicate(s) skipped` : ""}. Dates are interpreted as day/month/year.`);
      } else if (kind === "loan_products") {
        const { merged, preview: pv } = planLoanProductImports(loanProducts, rows);
        plannedPreview = pv;
        setPreviewFilter(pv.some((r) => r.status === "error") ? "errors" : "ok");
        const bad = pv.filter((r) => r.status === "error").length;
        const ok = pv.filter((r) => r.status === "ok").length;
        const skip = pv.filter((r) => r.status === "skip").length;
        setPreview(plannedPreview);
        if (!merged || bad > 0) {
          setError(`${bad} row(s) have errors. Fix the file before import.`);
        } else if (ok === 0) {
          setError("No rows ready to import.");
        } else {
          const mergeCount = merged.length;
          setError(null);
          setResultMessage(
            `Ready: ${ok} row(s) in file → ${mergeCount} product(s) saved when imported${skip ? `, ${skip} skipped` : ""}.`
          );
        }
      } else if (kind === "member_loans") {
        if (!parseIsoDateOnly(portfolioAsOfDate)) {
          setError("Set a valid balances snapshot date (YYYY-MM-DD).");
          setPreview(null);
          return;
        }
        if (disbursementFrom && disbursementTo && disbursementFrom > disbursementTo) {
          setError("Disbursement date From cannot be after To.");
          setPreview(null);
          return;
        }
        const selectedRows = rows.filter((row) => {
          const date = getLoanImportDisbursementDate(row);
          return (!disbursementFrom || (date !== null && date >= disbursementFrom)) && (!disbursementTo || (date !== null && date <= disbursementTo));
        });
        if (selectedRows.length === 0) {
          setError("No loan rows fall within the selected disbursement date range.");
          setPreview(null);
          return;
        }
        const ctx = await loadSaccoBulkImportContext(orgId);
        const existingLoans = await fetchLoansForOrganization(orgId);
        const { preview: pv } = planMemberLoansPortfolioImport(ctx, existingLoans, loanProducts, selectedRows, portfolioAsOfDate);
        plannedPreview = pv;
        setPreview(plannedPreview);
        const bad = pv.filter((r) => r.status === "error").length;
        setPreviewFilter(bad ? "errors" : "ok");
        const ok = pv.filter((r) => r.status === "ok").length;
        if (bad > 0) {
          setError(`${bad} row(s) have errors. Fix the file before import.`);
        } else if (ok === 0) {
          setError("No rows ready to import.");
        } else {
          setError(null);
          setResultMessage(
            `Ready: ${ok} loan row(s)${disbursementFrom || disbursementTo ? ` in ${disbursementFrom || "the beginning"} to ${disbursementTo || "the latest date"}` : ""} (default snapshot date ${portfolioAsOfDate}; column balance_as_at overrides per row when set).`
          );
        }
      } else {
        if (kind === "savings_balances" && !parseIsoDateOnly(savingsBalanceAsAt)) {
          setError("Set a valid balance effective / as-at date (YYYY-MM-DD).");
          setPreview(null);
          return;
        }
        const ctx = await loadSaccoBulkImportContext(orgId);
        const planned =
          kind === "savings_balances" ? planSavingsBalanceImports(ctx, rows, savingsBalanceAsAt) : planMemberProfileImports(ctx, rows);
        plannedPreview = planned.preview;
        setPreview(plannedPreview);
        const ok = plannedPreview.filter((r) => r.status === "ok").length;
        const bad = plannedPreview.filter((r) => r.status === "error").length;
        setPreviewFilter(bad ? "errors" : "ok");
        const skip = plannedPreview.filter((r) => r.status === "skip").length;
        if (bad > 0) {
          setError(`${bad} row(s) have errors. Fix the file or remove those rows before import.`);
        } else if (ok === 0) {
          setError("No rows ready to import.");
        } else {
          setError(null);
          setResultMessage(`Ready: ${ok} row(s)${skip ? `, ${skip} skipped` : ""}.`);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed.");
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [orgId, file, kind, loanProducts, portfolioAsOfDate, savingsBalanceAsAt, cashbookDefaultEffectiveDate, disbursementFrom, disbursementTo]);

  const runImport = async () => {
    if (!orgId || !file || !canOperate || running) return;
    const okCount = preview?.filter((r) => r.status === "ok").length ?? 0;
    if (okCount === 0) {
      setError("Run preview first and fix errors.");
      return;
    }

    if (kind === "historical_cashbook") {
      if (!confirm(`Post ${okCount} historical cashbook transaction(s)?\n\nEach file Date is kept as the effective date. Blank Dates use ${cashbookDefaultEffectiveDate}. This changes member savings/share balances and loan balances. Duplicate source rows are blocked.`)) return;
    } else if (kind === "loan_products") {
      if (
        !confirm(
          `Import ${okCount} loan product row(s) from the file?\n\nProducts are matched or created by name. Products not listed in the file are unchanged.\n\nThis updates live configuration. Export current products from Loan products if you need a backup.`
        )
      ) {
        return;
      }
    } else if (kind === "member_loans") {
      if (
        !confirm(
          `Import ${okCount} member loan row(s)?\n\nBalances and terms are written to the live loan portfolio. Snapshot context: ${portfolioAsOfDate} (per-row balance_as_at can override).\n\nEnsure members and loan products exist before importing.`
        )
      ) {
        return;
      }
    } else if (kind === "savings_balances") {
      if (!confirm(`Import ${okCount} savings balance row(s) as at ${savingsBalanceAsAt}?\n\nThis is a balance snapshot, not a cash transaction. Existing balances will be replaced.`)) return;
    } else {
      if (
        !confirm(
          `Import ${okCount} row(s) for "${selected.label}"?\n\nThis updates live data. Consider exporting a backup from the member list / savings accounts list first.`
        )
      ) {
        return;
      }
    }

    setRunning(true);
    setError(null);
    setResultMessage(null);
    setImportProgress({ completed: 0, total: okCount, imported: 0, failed: 0 });
    try {
      const { rows } = await parseBulkImportFile(file);

      if (kind === "historical_cashbook") {
        const ctx = await loadHistoricalImportContext(orgId);
        const plans = planHistoricalCashbookRows(ctx, rows, cashbookDefaultEffectiveDate);
        const result = await applyHistoricalCashbookPlans(orgId, plans, setImportProgress);
        await refreshSaccoWorkspace();
        setResultMessage(`Done. Imported ${result.imported} historical transaction(s).`);
        if (result.errors.length) setError(result.errors.slice(0, 10).join("\n"));
      } else if (kind === "loan_products") {
        const { merged } = planLoanProductImports(loanProducts, rows);
        if (!merged) {
          setError("Import aborted: validation failed. Run preview again.");
          return;
        }
        const result = await applyLoanProductsImport(orgId, merged);
        setImportProgress({ completed: okCount, total: okCount, imported: result.updated, failed: result.errors });
        await refreshSaccoWorkspace();
        setResultMessage(
          `Done. Saved ${result.updated} loan product(s) in catalog.` + (result.errors ? ` ${result.errors} failed.` : "")
        );
        if (result.messages.length) setError(result.messages.slice(0, 5).join("\n"));
      } else if (kind === "member_loans") {
        const selectedRows = rows.filter((row) => {
          const date = getLoanImportDisbursementDate(row);
          return (!disbursementFrom || (date !== null && date >= disbursementFrom)) && (!disbursementTo || (date !== null && date <= disbursementTo));
        });
        const ctx = await loadSaccoBulkImportContext(orgId);
        const existingLoans = await fetchLoansForOrganization(orgId);
        const { plans } = planMemberLoansPortfolioImport(ctx, existingLoans, loanProducts, selectedRows, portfolioAsOfDate);
        const okPlans = plans.filter((p) => preview?.some((r) => r.line === p.line && r.status === "ok"));
        const result = await applyMemberLoansPortfolioPlans(okPlans);
        setImportProgress({ completed: okCount, total: okCount, imported: result.updated, failed: result.errors });
        await refreshSaccoWorkspace();
        setResultMessage(
          `Done. Applied ${result.updated} loan row(s).` + (result.errors ? ` ${result.errors} failed.` : "")
        );
        if (result.messages.length) setError(result.messages.slice(0, 5).join("\n"));
      } else if (kind === "savings_balances") {
        const ctx = await loadSaccoBulkImportContext(orgId);
        const { plans } = planSavingsBalanceImports(ctx, rows, savingsBalanceAsAt);
        const okPlans = plans.filter((p) => preview?.some((r) => r.line === p.line && r.status === "ok"));
        const result = await applySavingsBalancePlans(orgId, okPlans, setImportProgress);
        await refreshSaccoWorkspace();
        setResultMessage(
          `Done. Updated ${result.updated} account(s) as at ${savingsBalanceAsAt}.` + (result.errors ? ` ${result.errors} failed.` : "")
        );
        if (result.messages.length) setError(result.messages.slice(0, 5).join("\n"));
      } else {
        const ctx = await loadSaccoBulkImportContext(orgId);
        const { plans } = planMemberProfileImports(ctx, rows);
        const okPlans = plans.filter((p) => preview?.some((r) => r.line === p.line && r.status === "ok"));
        const result = await applyMemberProfilePlans(okPlans);
        setImportProgress({ completed: okCount, total: okCount, imported: result.updated, failed: result.errors });
        await refreshSaccoWorkspace();
        setResultMessage(
          `Done. Updated ${result.updated} member(s).` + (result.errors ? ` ${result.errors} failed.` : "")
        );
        if (result.messages.length) setError(result.messages.slice(0, 5).join("\n"));
      }
      await runPreview();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setRunning(false);
    }
  };

  if (!orgId) {
    return (
      <div className="p-6 max-w-3xl mx-auto text-sm text-slate-600">
        Link your staff account to an organization to use bulk import.
      </div>
    );
  }

  const previewOk = preview?.filter((r) => r.status === "ok").length ?? 0;
  const previewErr = preview?.filter((r) => r.status === "error").length ?? 0;
  // All rows are validated. Keep successful-row DOM bounded, while always
  // rendering the complete error worklist so operators can fix it quickly.
  const filteredPreviewRows = preview?.filter((row) => previewFilter === "all" || (previewFilter === "errors" ? row.status === "error" : row.status === "ok")) ?? [];
  const previewRowsToRender = previewFilter === "errors" ? filteredPreviewRows : filteredPreviewRows.slice(0, 500);

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">
          {lockedKind === "historical_cashbook"
            ? "Cashbook bulk upload"
            : lockedKind === "loan_products"
            ? "Loan product bulk import"
            : lockedKind === "member_loans"
              ? cashbookMode ? "Loan input & approval" : "Member loan portfolio import"
              : "Bulk import"}
        </h1>
        <PageNotes
          ariaLabel={
            lockedKind === "historical_cashbook"
              ? "Cashbook upload help"
              : lockedKind === "loan_products"
              ? "Loan product import help"
              : lockedKind === "member_loans"
                ? "Member loan import help"
                : "Bulk import help"
          }
        >
          {lockedKind === "historical_cashbook" ? (
            <p className="text-sm text-slate-700">
              Upload the legacy Cashbook CSV or Excel file, then review every match before posting. BOAT imports deposits, withdrawals, shares, charges, fees and loan repayments, and prevents duplicate source rows from being posted twice.
            </p>
          ) : lockedKind === "loan_products" ? (
            <p className="text-sm text-slate-700">
              Upload CSV or Excel to create or update <strong>loan products</strong> (rates, fees, limits). Each row targets a product
              by <strong>name</strong>; products omitted from the file are unchanged. Super Admin or organization Admin only.
            </p>
          ) : lockedKind === "member_loans" ? (
            <p className="text-sm text-slate-700">
              <strong>Create:</strong> member_number (or legacy <code className="text-xs">Client Name.</code> ending with the member number), loan_type or loan_code, and principal. The approval register's <code className="text-xs">Date</code>, <code className="text-xs">Period</code>, loan fees and Net Amount are recognized and checked. Set the date range to January before previewing the January upload.{" "}
              <strong>Update later:</strong> same <code className="text-xs">loan_number</code> with only balance (and optional balance_as_at).{" "}
              Match order: loan_number → loan_id → member + loan_type. Empty columns are left unchanged on update. Admin only.
            </p>
          ) : (
            <p className="text-sm text-slate-700">
              Upload CSV or Excel to update members, savings balances, loan products, or member loan balances. Savings imports need
              existing accounts (use <strong>Savings settings → Backfill</strong> first).
            </p>
          )}
        </PageNotes>
      </header>

      {subscriptionReadOnly ? <ReadOnlyNotice message="Subscription inactive — imports are disabled." /> : null}
      {!subscriptionReadOnly && !canOperate ? <ReadOnlyNotice message={restrictionMessage} /> : null}

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
        {!lockedKind ? (
          <>
            <label className="block text-sm font-medium text-slate-700">Import type</label>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {IMPORT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  disabled={false}
                  onClick={() => {
                    setKindUnlocked(opt.id);
                    resetPreview();
                    setFile(null);
                  }}
                  className={`rounded-lg border p-3 text-left text-sm transition ${
                    kind === opt.id
                      ? "border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600/30"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <span className="font-semibold text-slate-900">{opt.label}</span>
                  <p className="mt-1 text-xs text-slate-600">{opt.description}</p>
                </button>
              ))}
            </div>
          </>
        ) : null}

        {(kind === "member_loans" || lockedKind === "member_loans") && (
          <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3">
            <label className="block text-sm font-medium text-slate-800 mb-1">Balances & details (default as-of date)</label>
            <p className="text-xs text-slate-600 mb-2">
              Used when a row does not include <code className="text-[11px]">balance_as_at</code>. Each row can still set its own{" "}
              <code className="text-[11px]">balance_as_at</code> for mixed cut-off dates.
            </p>
            <input
              type="date"
              value={portfolioAsOfDate}
              onChange={(e) => {
                setPortfolioAsOfDate(e.target.value);
                resetPreview();
              }}
              disabled={!canOperate}
              className="max-w-[220px] px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
            />
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-800">Disbursement date from
                <input type="date" value={disbursementFrom} onChange={(e) => { setDisbursementFrom(e.target.value); resetPreview(); }} disabled={!canOperate} className="mt-1 block w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500 bg-white" />
              </label>
              <label className="text-sm font-medium text-slate-800">Disbursement date to
                <input type="date" value={disbursementTo} onChange={(e) => { setDisbursementTo(e.target.value); resetPreview(); }} disabled={!canOperate} className="mt-1 block w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500 bg-white" />
              </label>
            </div>
            <p className="mt-2 text-xs text-slate-600">Optional. Set both dates to upload only loans disbursed in that period. Rows outside the range are never posted.</p>
          </div>
        )}

        {kind === "savings_balances" && (
          <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-3">
            <label className="block text-sm font-medium text-slate-800 mb-1">Balance effective / as-at date</label>
            <p className="text-xs text-slate-600 mb-2">Required. This records the cut-off date for every balance in this upload. It is a snapshot date, not a cash transaction date.</p>
            <input
              type="date"
              value={savingsBalanceAsAt}
              onChange={(e) => { setSavingsBalanceAsAt(e.target.value); resetPreview(); }}
              disabled={!canOperate}
              className="max-w-[220px] px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
            />
            <div className="mt-4 border-t border-emerald-100 pt-3">
              <p className="text-sm font-semibold text-slate-800">Post imported opening balances to the Balance Sheet</p>
              <p className="mt-1 text-xs text-slate-600">Posts one balanced journal: debit <strong>8040 Opening Balance Clearing</strong>; credit product 11, 12, 13 and 14 balances to <strong>21011, 21012, 21013 and 21014</strong>.</p>
              <div className="mt-2 flex flex-wrap items-end gap-2"><label className="text-xs font-medium text-slate-700">As-at date<input type="date" value={openingJournalDate} onChange={(e) => setOpeningJournalDate(e.target.value)} disabled={!canOperate || postingOpeningJournal} className="mt-1 block rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" /></label><button type="button" onClick={() => void postSavingsOpeningJournal()} disabled={!canOperate || postingOpeningJournal} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{postingOpeningJournal ? "Posting…" : "Post opening journal"}</button></div>
            </div>
          </div>
        )}

        {kind === "historical_cashbook" && (
          <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-3">
            <label className="block text-sm font-medium text-slate-800 mb-1">Default effective date for blank file dates</label>
            <p className="text-xs text-slate-600 mb-2">Each row's Date remains its effective date. This date is used only when a row has no Date, so older cashbook history is not accidentally moved to one day.</p>
            <input
              type="date"
              value={cashbookDefaultEffectiveDate}
              onChange={(e) => { setCashbookDefaultEffectiveDate(e.target.value); resetPreview(); }}
              disabled={!canOperate}
              className="max-w-[220px] px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
            />
          </div>
        )}

        <p className="text-xs text-slate-500">{selected.description}</p>

        <div className="flex flex-wrap gap-2">
          {!lockedKind ? (
            <button
              type="button"
              onClick={downloadSaccoMigrationWorkbook}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
            >
              <Download className="h-4 w-4" />
              Download complete migration workbook
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              if (kind === "loan_products") downloadLoanProductsBulkTemplate();
              else if (kind === "member_loans") downloadMemberLoansPortfolioTemplate();
              else downloadSaccoBulkImportTemplate(kind);
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-4 w-4" />
            Download template
          </button>
        </div>

        {importProgress ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3" role="status" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium text-emerald-950">
              <span>{running ? "Importing…" : "Import complete"} {importProgress.completed.toLocaleString()} of {importProgress.total.toLocaleString()} rows</span>
              <span>{Math.round((importProgress.completed / Math.max(importProgress.total, 1)) * 100)}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-emerald-100">
              <div className="h-full rounded-full bg-emerald-600 transition-[width] duration-300" style={{ width: `${Math.round((importProgress.completed / Math.max(importProgress.total, 1)) * 100)}%` }} />
            </div>
            <p className="mt-2 text-xs text-emerald-900">Posted: {importProgress.imported.toLocaleString()}{importProgress.failed ? ` · failed: ${importProgress.failed.toLocaleString()}` : ""}</p>
          </div>
        ) : null}

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">File</label>
          <input
            type="file"
            accept=".csv,.txt,.xlsx,.xls"
            disabled={!canOperate}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              resetPreview();
            }}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-700 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-emerald-800"
          />
          {file ? <p className="mt-1 text-xs text-slate-500">{file.name}</p> : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canOperate || !file || loading || (kind === "member_loans" && !parseIsoDateOnly(portfolioAsOfDate))}
            onClick={() => void runPreview()}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
            Preview
          </button>
          <button
            type="button"
            disabled={
              !canOperate ||
              !file ||
              loading ||
              running ||
              previewOk === 0 ||
              previewErr > 0 ||
              (kind === "member_loans" && !parseIsoDateOnly(portfolioAsOfDate))
            }
            onClick={() => void runImport()}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Run import
          </button>
        </div>

        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 whitespace-pre-wrap">
            {error}
          </p>
        ) : null}
        {resultMessage && !error ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            {resultMessage}
          </p>
        ) : null}
      </div>

      {preview && preview.length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3 flex flex-wrap gap-3 text-sm">
            <span className="text-emerald-700 font-medium">{previewOk} OK</span>
            {previewErr > 0 ? <span className="text-red-700 font-medium">{previewErr} errors</span> : null}
            <span className="text-slate-500">All {preview.length.toLocaleString()} rows validated</span>
          </div>
          <div className="border-b border-slate-100 px-4 py-2.5 flex flex-wrap items-center gap-2 bg-slate-50/70">
            <span className="mr-1 text-xs font-medium text-slate-600">Show</span>
            {([
              ["errors", `Errors (${previewErr})`],
              ["ok", `Ready (${previewOk})`],
              ["all", `All (${preview.length})`],
            ] as const).map(([filter, label]) => (
              <button
                key={filter}
                type="button"
                onClick={() => setPreviewFilter(filter)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${previewFilter === filter ? filter === "errors" ? "bg-red-600 text-white" : "bg-slate-800 text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"}`}
              >
                {label}
              </button>
            ))}
            {previewFilter !== "errors" && filteredPreviewRows.length > previewRowsToRender.length ? <span className="ml-auto text-xs text-slate-500">Showing first 500; switch to Errors to see every issue.</span> : null}
            {previewFilter === "errors" && previewErr === 0 ? <span className="text-xs text-emerald-700">No errors — ready to import.</span> : null}
          </div>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="p-2 text-left w-14">Line</th>
                  <th className="p-2 text-left w-20">Status</th>
                  <th className="p-2 text-left">Result</th>
                </tr>
              </thead>
              <tbody>
                {previewRowsToRender.map((r) => (
                  <tr key={r.line} className="border-t border-slate-100">
                    <td className="p-2 tabular-nums text-slate-500">{r.line}</td>
                    <td className="p-2">
                      <span
                        className={
                          r.status === "ok"
                            ? "text-emerald-700 font-medium"
                            : r.status === "error"
                              ? "text-red-700 font-medium"
                              : "text-slate-500"
                        }
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="p-2 text-slate-800">{r.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
