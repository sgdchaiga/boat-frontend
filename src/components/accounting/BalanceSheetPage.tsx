import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { businessTodayISO } from "../../lib/timezone";
import { downloadCsv, exportAccountingPdf, isNonZeroGlAmount } from "../../lib/accountingReportExport";
import { AccountingExportButtons } from "./AccountingExportButtons";
import { PageNotes } from "../common/PageNotes";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId, filterJournalLinesByOrganizationId } from "../../lib/supabaseOrgFilter";
import { normalizeGlAccountRow, normalizeGlAccountRows } from "../../lib/glAccountNormalize";
import { accountBalanceDelta, isCashEquivalentAccount } from "../../lib/cashFlowStatement";
import { Info } from "lucide-react";

type AccountTotal = { account_id: string; account_code: string; account_name: string; account_type: "asset" | "liability" | "equity"; category: string | null; total: number };
type DrillLine = {
  id: string;
  entry_date: string;
  description: string;
  transaction_id: string | null;
  reference_type: string | null;
  debit: number;
  credit: number;
  line_description: string | null;
};
const CASH_BASIS_REFERENCE_TYPES = ["payment", "pos", "vendor_payment", "expense", "school_payment"] as const;
const JOURNAL_LINE_PAGE_SIZE = 1000;

export function BalanceSheetPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const [asOfDate, setAsOfDate] = useState(() => businessTodayISO());
  const [basis, setBasis] = useState<"accrual" | "cash">("accrual");
  const [showBasisHelp, setShowBasisHelp] = useState(false);
  const [showZeroBalanceAccounts, setShowZeroBalanceAccounts] = useState(false);
  const [compareRange, setCompareRange] = useState<"none" | "previous_period" | "same_period_last_year">("none");
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [assets, setAssets] = useState<AccountTotal[]>([]);
  const [liabilities, setLiabilities] = useState<AccountTotal[]>([]);
  const [equity, setEquity] = useState<AccountTotal[]>([]);
  const [totalAssets, setTotalAssets] = useState(0);
  const [totalLiabilities, setTotalLiabilities] = useState(0);
  const [totalEquity, setTotalEquity] = useState(0);
  const [netIncome, setNetIncome] = useState(0);
  const [previousAssets, setPreviousAssets] = useState<AccountTotal[]>([]);
  const [previousLiabilities, setPreviousLiabilities] = useState<AccountTotal[]>([]);
  const [previousEquity, setPreviousEquity] = useState<AccountTotal[]>([]);
  const [previousTotalAssets, setPreviousTotalAssets] = useState(0);
  const [previousTotalLiabilities, setPreviousTotalLiabilities] = useState(0);
  const [previousTotalEquity, setPreviousTotalEquity] = useState(0);
  const [previousNetIncome, setPreviousNetIncome] = useState(0);
  const [previousLabel, setPreviousLabel] = useState("Previous");
  const [drillAccount, setDrillAccount] = useState<AccountTotal | null>(null);
  const [drillRows, setDrillRows] = useState<DrillLine[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, [asOfDate, compareRange, basis]);

  const fetchSnapshotForDate = async (toDate: string) => {
    const fetchLinesPage = (from: number, to: number) => {
      const query = supabase
        .from("journal_entry_lines")
        .select(
          "debit, credit, gl_accounts!inner(id, account_code, account_name, account_type, category), journal_entries!inner(entry_date)"
        )
        .lte("journal_entries.entry_date", toDate)
        .eq("journal_entries.is_posted", true)
        .eq("journal_entries.is_deleted", false)
        .order("entry_date", { ascending: true, referencedTable: "journal_entries" })
        .order("id", { ascending: true })
        .range(from, to);
      if (basis === "cash") {
        query.in("journal_entries.reference_type", [...CASH_BASIS_REFERENCE_TYPES]);
      }
      return filterJournalLinesByOrganizationId(query, orgId, superAdmin);
    };
    const [linesData, accRes] = await Promise.all([
      (async () => {
        const rows: Array<{
          debit: number;
          credit: number;
          gl_accounts: { id: string; account_code: string; account_name: string; account_type: string; category: string | null } | null;
        }> = [];
        for (let from = 0; ; from += JOURNAL_LINE_PAGE_SIZE) {
          const { data, error } = await fetchLinesPage(from, from + JOURNAL_LINE_PAGE_SIZE - 1);
          if (error) throw new Error(error.message);
          rows.push(...((data || []) as typeof rows));
          if ((data || []).length < JOURNAL_LINE_PAGE_SIZE) break;
        }
        return rows;
      })(),
      filterByOrganizationId(
        supabase
          .from("gl_accounts")
          .select("*")
          .order("account_code"),
        orgId,
        superAdmin
      ),
    ]);
    if (accRes.error) throw new Error(accRes.error.message);

    const accounts = normalizeGlAccountRows((accRes.data || []) as unknown[])
      .filter((row) =>
        row.is_active &&
        ["asset", "liability", "equity", "income", "expense"].includes(row.account_type)
      )
      .map((row) => ({
        id: row.id,
        account_code: row.account_code,
        account_name: row.account_name,
        account_type: row.account_type,
        category: row.category,
      }));
    const accMap: Record<string, { id: string; account_code: string; account_name: string; account_type: string; category: string | null }> = Object.fromEntries(
      accounts.map((a) => [a.id, a])
    );
    const byAccount: Record<string, number> = {};
    (linesData || []).forEach((l: { debit: number; credit: number; gl_accounts: { id: string; account_code: string; account_name: string; account_type: string; category: string | null } | null }) => {
      const acc = l.gl_accounts ? normalizeGlAccountRow(l.gl_accounts as unknown as Record<string, unknown>) : null;
      if (!acc) return;
      accMap[acc.id] = acc;
      if (!byAccount[acc.id]) byAccount[acc.id] = 0;
      const dr = Number(l.debit) || 0;
      const cr = Number(l.credit) || 0;
      byAccount[acc.id] += accountBalanceDelta(acc.account_type, dr, cr);
    });
    accounts.forEach((acc) => {
      if (!(acc.id in byAccount)) byAccount[acc.id] = 0;
    });

    const a: AccountTotal[] = [], li: AccountTotal[] = [], eq: AccountTotal[] = [];
    let ta = 0, tl = 0, te = 0, ti = 0, tx = 0;
    Object.entries(byAccount).forEach(([id, total]) => {
      const acc = accMap[id];
      if (!acc) return;
      const row = {
        account_id: acc.id,
        account_code: acc.account_code,
        account_name: acc.account_name,
        account_type: acc.account_type as "asset" | "liability" | "equity",
        category: acc.category,
        total,
      };
      if (acc.account_type === "asset") { a.push(row); ta += total; }
      else if (acc.account_type === "liability") { li.push(row); tl += total; }
      else if (acc.account_type === "equity") { eq.push(row); te += total; }
      else if (acc.account_type === "income") { ti += total; }
      else if (acc.account_type === "expense") { tx += total; }
    });
    const ni = ti - tx;
    a.sort((x, y) => x.account_code.localeCompare(y.account_code));
    li.sort((x, y) => x.account_code.localeCompare(y.account_code));
    eq.sort((x, y) => x.account_code.localeCompare(y.account_code));

    return {
      assets: a,
      liabilities: li,
      equity: eq,
      totalAssets: ta,
      totalLiabilities: tl,
      totalEquity: te,
      netIncome: ni,
    };
  };

  const fetchData = async () => {
    setLoading(true);
    setFetchError(null);
    if (!orgId && !superAdmin) {
      setFetchError("Missing organization on your staff profile. Contact admin to link your account.");
      setAssets([]);
      setLiabilities([]);
      setEquity([]);
      setTotalAssets(0);
      setTotalLiabilities(0);
      setTotalEquity(0);
      setNetIncome(0);
      setPreviousTotalAssets(0);
      setPreviousTotalLiabilities(0);
      setPreviousTotalEquity(0);
      setPreviousNetIncome(0);
      setLoading(false);
      return;
    }
    try {
      const current = await fetchSnapshotForDate(asOfDate);
      setAssets(current.assets);
      setLiabilities(current.liabilities);
      setEquity(current.equity);
      setTotalAssets(current.totalAssets);
      setTotalLiabilities(current.totalLiabilities);
      setTotalEquity(current.totalEquity);
      setNetIncome(current.netIncome);

      if (compareRange === "none") {
        setPreviousLabel("Previous");
        setPreviousAssets([]);
        setPreviousLiabilities([]);
        setPreviousEquity([]);
        setPreviousTotalAssets(0);
        setPreviousTotalLiabilities(0);
        setPreviousTotalEquity(0);
        setPreviousNetIncome(0);
      } else {
        const d = new Date(`${asOfDate}T00:00:00`);
        if (compareRange === "previous_period") {
          d.setMonth(d.getMonth() - 1);
          setPreviousLabel("Previous period");
        } else {
          d.setFullYear(d.getFullYear() - 1);
          setPreviousLabel("Same period last year");
        }
        const prevDate = d.toISOString().slice(0, 10);
        const previous = await fetchSnapshotForDate(prevDate);
        setPreviousAssets(previous.assets);
        setPreviousLiabilities(previous.liabilities);
        setPreviousEquity(previous.equity);
        setPreviousTotalAssets(previous.totalAssets);
        setPreviousTotalLiabilities(previous.totalLiabilities);
        setPreviousTotalEquity(previous.totalEquity);
        setPreviousNetIncome(previous.netIncome);
      }
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : String(e));
      setAssets([]);
      setLiabilities([]);
      setEquity([]);
      setTotalAssets(0);
      setTotalLiabilities(0);
      setTotalEquity(0);
      setNetIncome(0);
      setPreviousAssets([]);
      setPreviousLiabilities([]);
      setPreviousEquity([]);
      setPreviousTotalAssets(0);
      setPreviousTotalLiabilities(0);
      setPreviousTotalEquity(0);
      setPreviousNetIncome(0);
    } finally {
      setLoading(false);
    }
  };

  /** Assets = Liabilities + Equity + (Revenue − Expenses) when P&L is not closed into equity. */
  const totalLiabEquityAndPnL = totalLiabilities + totalEquity + netIncome;
  const balanced = Math.abs(totalAssets - totalLiabEquityAndPnL) < 0.01;
  const fundsUnderManagement = useMemo(
    () => assets.filter((account) => isCashEquivalentAccount({
      id: account.account_id,
      account_code: account.account_code,
      account_name: account.account_name,
      account_type: account.account_type,
      category: account.category,
    })).reduce((sum, account) => sum + account.total, 0),
    [assets]
  );

  const assetsDisplayed = useMemo(
    () => (showZeroBalanceAccounts ? assets : assets.filter((r) => isNonZeroGlAmount(r.total))),
    [assets, showZeroBalanceAccounts]
  );
  const liabilitiesDisplayed = useMemo(
    () => (showZeroBalanceAccounts ? liabilities : liabilities.filter((r) => isNonZeroGlAmount(r.total))),
    [liabilities, showZeroBalanceAccounts]
  );
  const equityDisplayed = useMemo(
    () => (showZeroBalanceAccounts ? equity : equity.filter((r) => isNonZeroGlAmount(r.total))),
    [equity, showZeroBalanceAccounts]
  );
  const previousAssetsByCode = useMemo(() => new Map(previousAssets.map((r) => [r.account_code, r.total])), [previousAssets]);
  const previousLiabilitiesByCode = useMemo(() => new Map(previousLiabilities.map((r) => [r.account_code, r.total])), [previousLiabilities]);
  const previousEquityByCode = useMemo(() => new Map(previousEquity.map((r) => [r.account_code, r.total])), [previousEquity]);
  const drillRowsWithBalance = useMemo(() => {
    if (!drillAccount) return [];
    const rowsWithImpact = drillRows.map((row) => ({
      ...row,
      impact: accountBalanceDelta(drillAccount.account_type, row.debit, row.credit),
    }));
    let runningBalance = 0;
    return rowsWithImpact.map((row) => {
      runningBalance += row.impact;
      return { ...row, runningBalance };
    });
  }, [drillAccount, drillRows]);

  const openDrilldown = async (account: AccountTotal) => {
    setDrillAccount(account);
    setDrillRows([]);
    setDrillError(null);
    setDrillLoading(true);
    try {
      const fetchDrillPage = (from: number, to: number) => {
        const query = supabase
          .from("journal_entry_lines")
          .select(
            "id, debit, credit, line_description, journal_entries!inner(id, entry_date, description, transaction_id, reference_type), gl_accounts!inner(id)"
          )
          .eq("gl_account_id", account.account_id)
          .lte("journal_entries.entry_date", asOfDate)
          .eq("journal_entries.is_posted", true)
          .eq("journal_entries.is_deleted", false)
          .order("entry_date", { ascending: true, referencedTable: "journal_entries" })
          .order("id", { ascending: true })
          .range(from, to);
        if (basis === "cash") {
          query.in("journal_entries.reference_type", [...CASH_BASIS_REFERENCE_TYPES]);
        }
        return filterJournalLinesByOrganizationId(query, orgId, superAdmin);
      };
      const data: Array<{
        id: string;
        debit: number;
        credit: number;
        line_description: string | null;
        journal_entries: {
          entry_date: string;
          description: string;
          transaction_id: string | null;
          reference_type: string | null;
        } | null;
      }> = [];
      for (let from = 0; ; from += JOURNAL_LINE_PAGE_SIZE) {
        const { data: pageData, error } = await fetchDrillPage(from, from + JOURNAL_LINE_PAGE_SIZE - 1);
        if (error) throw new Error(error.message);
        data.push(...((pageData || []) as typeof data));
        if ((pageData || []).length < JOURNAL_LINE_PAGE_SIZE) break;
      }
      setDrillRows(
        data.map((row) => ({
          id: row.id,
          entry_date: row.journal_entries?.entry_date || "",
          description: row.journal_entries?.description || "",
          transaction_id: row.journal_entries?.transaction_id ?? null,
          reference_type: row.journal_entries?.reference_type ?? null,
          debit: Number(row.debit) || 0,
          credit: Number(row.credit) || 0,
          line_description: row.line_description,
        }))
      );
    } catch (e) {
      setDrillError(e instanceof Error ? e.message : String(e));
    } finally {
      setDrillLoading(false);
    }
  };

  const exportExcel = () => {
    const data: (string | number)[][] = [
      ["Balance Sheet", `As of ${asOfDate} (${basis === "cash" ? "Cash basis" : "Accrual basis"})`],
      [],
      ["Assets"],
      ["Code", "Name", "Amount"],
      ...assetsDisplayed.map((r) => [r.account_code, r.account_name, r.total.toFixed(2)]),
      ["", "Total Assets", totalAssets.toFixed(2)],
      [],
      ["Liabilities"],
      ["Code", "Name", "Amount"],
      ...liabilitiesDisplayed.map((r) => [r.account_code, r.account_name, r.total.toFixed(2)]),
      ["", "Total Liabilities", totalLiabilities.toFixed(2)],
      [],
      ["Equity"],
      ["Code", "Name", "Amount"],
      ...equityDisplayed.map((r) => [r.account_code, r.account_name, r.total.toFixed(2)]),
      ["", "Total Equity (GL)", totalEquity.toFixed(2)],
      [],
      ["Net income (P&L, cumulative)", "", netIncome.toFixed(2)],
      [],
      ["", "Liabilities + Equity + Net income", totalLiabEquityAndPnL.toFixed(2)],
      ["", "Check vs Total Assets", balanced ? "Balanced" : (totalAssets - totalLiabEquityAndPnL).toFixed(2)],
    ];
    downloadCsv(`balance-sheet-${asOfDate}.csv`, data);
  };

  const exportPdf = () => {
    exportAccountingPdf({
      title: "Balance Sheet",
      subtitle: `As of ${asOfDate} (${basis === "cash" ? "Cash basis" : "Accrual basis"})`,
      filename: `balance-sheet-${asOfDate}.pdf`,
      sections: [
        {
          title: "Assets",
          head: ["Code", "Name", "Amount"],
          body: assetsDisplayed.map((r) => [r.account_code, r.account_name, r.total.toFixed(2)]),
        },
        {
          title: "Liabilities",
          head: ["Code", "Name", "Amount"],
          body: liabilitiesDisplayed.map((r) => [r.account_code, r.account_name, r.total.toFixed(2)]),
        },
        {
          title: "Equity",
          head: ["Code", "Name", "Amount"],
          body: equityDisplayed.map((r) => [r.account_code, r.account_name, r.total.toFixed(2)]),
        },
        {
          title: "Net income (P&L, cumulative)",
          head: ["Description", "Amount"],
          body: [["Revenue less expenses (unclosed)", netIncome.toFixed(2)]],
        },
      ],
      footerLines: [
        `Total assets: ${totalAssets.toFixed(2)}`,
        `Total liabilities + equity + net income: ${totalLiabEquityAndPnL.toFixed(2)}`,
        balanced ? "Balanced." : `Difference: ${(totalAssets - totalLiabEquityAndPnL).toFixed(2)}`,
      ],
    });
  };

  return (
    <div className="p-6 md:p-8">
      <div className="mb-8">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-bold text-slate-900">Balance Sheet</h1>
          <PageNotes ariaLabel="Balance sheet help">
            <p>
              Assets, liabilities, and equity. Until revenue and expenses are closed into retained earnings,{" "}
              <strong>net income</strong> (income minus expense accounts) is included so the sheet balances: Assets = Liabilities + Equity + Net
              income.
            </p>
          </PageNotes>
        </div>
      </div>

      {fetchError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800" role="alert">
          {fetchError}
        </div>
      )}
      {!fetchError && basis === "cash" && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900" role="status">
          Cash basis view is enabled. This report is generated from posted journal entries.
        </div>
      )}
      {!fetchError && showBasisHelp && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700" role="status">
          Basis help: accrual includes all posted journals up to the selected date. Cash includes posted journals with reference types:
          <code className="text-xs"> payment</code>, <code className="text-xs">pos</code>, <code className="text-xs">vendor_payment</code>,{" "}
          <code className="text-xs">expense</code>.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex flex-wrap gap-4 items-center">
          <label className="flex items-center gap-2">As of</label>
          <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="border rounded-lg px-3 py-2" />
          <select
            value={compareRange}
            onChange={(e) => setCompareRange(e.target.value as "none" | "previous_period" | "same_period_last_year")}
            className="border rounded-lg px-3 py-2"
          >
            <option value="none">No comparison</option>
            <option value="previous_period">Compare with previous period</option>
            <option value="same_period_last_year">Compare with same period last year</option>
          </select>
          <select value={basis} onChange={(e) => setBasis(e.target.value as "accrual" | "cash")} className="border rounded-lg px-3 py-2">
            <option value="accrual">Accrual basis</option>
            <option value="cash">Cash basis</option>
          </select>
          <button
            type="button"
            onClick={() => setShowBasisHelp((v) => !v)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50"
            title={showBasisHelp ? "Hide basis help" : "Show basis help"}
            aria-label={showBasisHelp ? "Hide basis help" : "Show basis help"}
          >
            <Info className="h-4 w-4" />
          </button>
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showZeroBalanceAccounts}
              onChange={(e) => setShowZeroBalanceAccounts(e.target.checked)}
              className="rounded border-slate-300"
            />
            Show zero-balance accounts
          </label>
        </div>
        {!loading && !fetchError && <AccountingExportButtons onExcel={exportExcel} onPdf={exportPdf} />}
      </div>

      {!loading && !fetchError && basis === "accrual" && (
        <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Treasury funds under management</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{fundsUnderManagement.toFixed(2)}</p>
          <p className="mt-1 text-xs text-slate-600">Sum of posted cash and cash-equivalent asset accounts as of {asOfDate}; this equals the Treasury module total for the same date.</p>
        </div>
      )}

      {loading ? (
        <div className="text-slate-500">Loading…</div>
      ) : (
        <div className={`grid grid-cols-1 gap-6 items-start ${compareRange !== "none" ? "xl:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]" : ""}`}>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden max-w-2xl">
            <div className="p-4 border-b bg-slate-50 font-medium">Assets</div>
          <table className="w-full text-sm">
            {compareRange !== "none" && (
              <thead className="bg-slate-100">
                <tr>
                  <th className="p-3 text-left">Code</th>
                  <th className="p-3 text-left">Account</th>
                  <th className="p-3 text-right">Current</th>
                  <th className="p-3 text-right">{previousLabel}</th>
                </tr>
              </thead>
            )}
            <tbody>
              {assetsDisplayed.map((r) => (
                <tr key={r.account_code} className="border-t">
                  <td className="p-3 font-mono">{r.account_code}</td>
                   <td className="p-3">
                     <button type="button" onClick={() => void openDrilldown(r)} className="text-left text-blue-700 hover:underline">
                       {r.account_name}
                     </button>
                   </td>
                  <td className="p-3 text-right">{r.total.toFixed(2)}</td>
                  {compareRange !== "none" && <td className="p-3 text-right">{(previousAssetsByCode.get(r.account_code) ?? 0).toFixed(2)}</td>}
                </tr>
              ))}
              {assets.length === 0 && <tr><td colSpan={compareRange !== "none" ? 4 : 3} className="p-3 text-slate-500">No asset accounts</td></tr>}
              {assets.length > 0 && assetsDisplayed.length === 0 && (
                <tr>
                  <td colSpan={compareRange !== "none" ? 4 : 3} className="p-3 text-slate-500">
                    No non-zero asset accounts (turn on &quot;Show zero-balance accounts&quot; to list all).
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot className="bg-slate-100 font-medium">
              <tr>
                <td colSpan={2} className="p-3 text-right">Total Assets</td>
                <td className="p-3 text-right">{totalAssets.toFixed(2)}</td>
                {compareRange !== "none" && <td className="p-3 text-right">{previousTotalAssets.toFixed(2)}</td>}
              </tr>
            </tfoot>
          </table>
          <div className="p-4 border-t border-b bg-slate-50 font-medium">Liabilities</div>
          <table className="w-full text-sm">
            {compareRange !== "none" && (
              <thead className="bg-slate-100">
                <tr>
                  <th className="p-3 text-left">Code</th>
                  <th className="p-3 text-left">Account</th>
                  <th className="p-3 text-right">Current</th>
                  <th className="p-3 text-right">{previousLabel}</th>
                </tr>
              </thead>
            )}
            <tbody>
              {liabilitiesDisplayed.map((r) => (
                <tr key={r.account_code} className="border-t">
                  <td className="p-3 font-mono">{r.account_code}</td>
                   <td className="p-3">
                     <button type="button" onClick={() => void openDrilldown(r)} className="text-left text-blue-700 hover:underline">
                       {r.account_name}
                     </button>
                   </td>
                  <td className="p-3 text-right">{r.total.toFixed(2)}</td>
                  {compareRange !== "none" && <td className="p-3 text-right">{(previousLiabilitiesByCode.get(r.account_code) ?? 0).toFixed(2)}</td>}
                </tr>
              ))}
              {liabilities.length === 0 && <tr><td colSpan={compareRange !== "none" ? 4 : 3} className="p-3 text-slate-500">No liability accounts</td></tr>}
              {liabilities.length > 0 && liabilitiesDisplayed.length === 0 && (
                <tr>
                  <td colSpan={compareRange !== "none" ? 4 : 3} className="p-3 text-slate-500">
                    No non-zero liability accounts (turn on &quot;Show zero-balance accounts&quot; to list all).
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot className="bg-slate-100 font-medium">
              <tr>
                <td colSpan={2} className="p-3 text-right">Total Liabilities</td>
                <td className="p-3 text-right">{totalLiabilities.toFixed(2)}</td>
                {compareRange !== "none" && <td className="p-3 text-right">{previousTotalLiabilities.toFixed(2)}</td>}
              </tr>
            </tfoot>
          </table>
          <div className="p-4 border-t border-b bg-slate-50 font-medium">Equity</div>
          <table className="w-full text-sm">
            {compareRange !== "none" && (
              <thead className="bg-slate-100">
                <tr>
                  <th className="p-3 text-left">Code</th>
                  <th className="p-3 text-left">Account</th>
                  <th className="p-3 text-right">Current</th>
                  <th className="p-3 text-right">{previousLabel}</th>
                </tr>
              </thead>
            )}
            <tbody>
              {equityDisplayed.map((r) => (
                <tr key={r.account_code} className="border-t">
                  <td className="p-3 font-mono">{r.account_code}</td>
                   <td className="p-3">
                     <button type="button" onClick={() => void openDrilldown(r)} className="text-left text-blue-700 hover:underline">
                       {r.account_name}
                     </button>
                   </td>
                  <td className="p-3 text-right">{r.total.toFixed(2)}</td>
                  {compareRange !== "none" && <td className="p-3 text-right">{(previousEquityByCode.get(r.account_code) ?? 0).toFixed(2)}</td>}
                </tr>
              ))}
              {equity.length === 0 && <tr><td colSpan={compareRange !== "none" ? 4 : 3} className="p-3 text-slate-500">No equity accounts</td></tr>}
              {equity.length > 0 && equityDisplayed.length === 0 && (
                <tr>
                  <td colSpan={compareRange !== "none" ? 4 : 3} className="p-3 text-slate-500">
                    No non-zero equity accounts (turn on &quot;Show zero-balance accounts&quot; to list all).
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot className="bg-slate-100 font-medium">
              <tr>
                <td colSpan={2} className="p-3 text-right">Total Equity (GL accounts)</td>
                <td className="p-3 text-right">{totalEquity.toFixed(2)}</td>
                {compareRange !== "none" && <td className="p-3 text-right">{previousTotalEquity.toFixed(2)}</td>}
              </tr>
            </tfoot>
          </table>
          <div className="p-4 border-t border-b bg-slate-50 font-medium text-slate-800">Net income (P&amp;L, cumulative)</div>
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-t">
                <td className="p-3 font-mono">—</td>
                <td className="p-3">Revenue less expenses (unclosed)</td>
                <td className="p-3 text-right">{netIncome.toFixed(2)}</td>
                {compareRange !== "none" && <td className="p-3 text-right">{previousNetIncome.toFixed(2)}</td>}
              </tr>
            </tbody>
          </table>
            <div className={`p-4 border-t font-medium ${balanced ? "text-emerald-600 bg-emerald-50" : "text-amber-600 bg-amber-50"}`}>
              Total Liabilities + Equity + Net income: {totalLiabEquityAndPnL.toFixed(2)} · Total Assets: {totalAssets.toFixed(2)}{" "}
              {balanced ? "✓ Balanced" : "(diff: " + (totalAssets - totalLiabEquityAndPnL).toFixed(2) + ")"}
            </div>
          </div>
          {compareRange !== "none" && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden max-w-2xl xl:max-w-none">
              <div className="p-4 border-b bg-slate-50 font-medium">Comparison ({previousLabel})</div>
              <table className="w-full text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="p-3 text-left">Metric</th>
                    <th className="p-3 text-right">Current</th>
                    <th className="p-3 text-right">{previousLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t">
                    <td className="p-3">Total assets</td>
                    <td className="p-3 text-right">{totalAssets.toFixed(2)}</td>
                    <td className="p-3 text-right">{previousTotalAssets.toFixed(2)}</td>
                  </tr>
                  <tr className="border-t">
                    <td className="p-3">Total liabilities</td>
                    <td className="p-3 text-right">{totalLiabilities.toFixed(2)}</td>
                    <td className="p-3 text-right">{previousTotalLiabilities.toFixed(2)}</td>
                  </tr>
                  <tr className="border-t">
                    <td className="p-3">Total equity (GL)</td>
                    <td className="p-3 text-right">{totalEquity.toFixed(2)}</td>
                    <td className="p-3 text-right">{previousTotalEquity.toFixed(2)}</td>
                  </tr>
                  <tr className="border-t font-medium bg-slate-50">
                    <td className="p-3">Net income (unclosed P&amp;L)</td>
                    <td className="p-3 text-right">{netIncome.toFixed(2)}</td>
                    <td className="p-3 text-right">{previousNetIncome.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {drillAccount && (
        <div className="fixed inset-0 z-50 bg-black/40 p-4 overflow-y-auto" onClick={() => setDrillAccount(null)}>
          <div
            className="mx-auto mt-8 w-full max-w-5xl rounded-xl bg-white border border-slate-200 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Drill-down: {drillAccount.account_code} {drillAccount.account_name}
                </h3>
                <p className="text-xs text-slate-500">
                  Posted {basis} basis transactions through {asOfDate}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrillAccount(null)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
              >
                Close
              </button>
            </div>
            <div className="p-4">
              {drillLoading ? (
                <div className="text-slate-500">Loading transactions...</div>
              ) : drillError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{drillError}</div>
              ) : (
                <div className="overflow-auto max-h-[65vh]">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-100 sticky top-0">
                      <tr>
                        <th className="p-2 text-left">Date</th>
                        <th className="p-2 text-left">Description</th>
                        <th className="p-2 text-left">Journal</th>
                        <th className="p-2 text-right">Debit</th>
                        <th className="p-2 text-right">Credit</th>
                        <th className="p-2 text-right">Impact</th>
                        <th className="p-2 text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drillRowsWithBalance.map((row) => {
                        return (
                          <tr key={row.id} className="border-t">
                            <td className="p-2 whitespace-nowrap">{row.entry_date}</td>
                            <td className="p-2">
                              <div>{row.description || "—"}</div>
                              {row.line_description ? <div className="text-xs text-slate-500">{row.line_description}</div> : null}
                            </td>
                            <td className="p-2 text-xs text-slate-600">
                              {row.transaction_id || "—"}
                              {row.reference_type ? <div>{row.reference_type}</div> : null}
                            </td>
                            <td className="p-2 text-right">{row.debit.toFixed(2)}</td>
                            <td className="p-2 text-right">{row.credit.toFixed(2)}</td>
                            <td className="p-2 text-right">{row.impact.toFixed(2)}</td>
                            <td className="p-2 text-right font-medium">{row.runningBalance.toFixed(2)}</td>
                          </tr>
                        );
                      })}
                      {drillRows.length === 0 && (
                        <tr>
                          <td colSpan={7} className="p-4 text-center text-slate-500">
                            No posted transactions found for this account and filter.
                          </td>
                        </tr>
                      )}
                    </tbody>
                    {drillRows.length > 0 && (
                      <tfoot className="bg-slate-100 font-medium sticky bottom-0">
                        <tr>
                          <td colSpan={6} className="p-2 text-right">Balance as of {asOfDate}</td>
                          <td className="p-2 text-right">{drillAccount.total.toFixed(2)}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
