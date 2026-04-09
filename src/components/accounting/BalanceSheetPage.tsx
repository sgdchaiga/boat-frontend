import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { businessTodayISO } from "../../lib/timezone";
import { downloadCsv, exportAccountingPdf } from "../../lib/accountingReportExport";
import { AccountingExportButtons } from "./AccountingExportButtons";
import { PageNotes } from "../common/PageNotes";

type AccountTotal = { account_code: string; account_name: string; total: number };

function accountBalanceDelta(
  accountType: string,
  debit: number,
  credit: number
): number {
  const dr = debit || 0;
  const cr = credit || 0;
  if (accountType === "asset" || accountType === "expense") return dr - cr;
  return cr - dr;
}

export function BalanceSheetPage() {
  const [asOfDate, setAsOfDate] = useState(() => businessTodayISO());
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [assets, setAssets] = useState<AccountTotal[]>([]);
  const [liabilities, setLiabilities] = useState<AccountTotal[]>([]);
  const [equity, setEquity] = useState<AccountTotal[]>([]);
  const [totalAssets, setTotalAssets] = useState(0);
  const [totalLiabilities, setTotalLiabilities] = useState(0);
  const [totalEquity, setTotalEquity] = useState(0);
  const [netIncome, setNetIncome] = useState(0);

  useEffect(() => {
    fetchData();
  }, [asOfDate]);

  const fetchData = async () => {
    setLoading(true);
    setFetchError(null);
    const { data: entriesData, error: e1 } = await supabase
      .from("journal_entries")
      .select("id")
      .lte("entry_date", asOfDate);

    if (e1) {
      setFetchError(e1.message);
      setAssets([]);
      setLiabilities([]);
      setEquity([]);
      setTotalAssets(0);
      setTotalLiabilities(0);
      setTotalEquity(0);
      setNetIncome(0);
      setLoading(false);
      return;
    }

    if (!entriesData?.length) {
      setAssets([]);
      setLiabilities([]);
      setEquity([]);
      setTotalAssets(0);
      setTotalLiabilities(0);
      setTotalEquity(0);
      setNetIncome(0);
      setLoading(false);
      return;
    }

    const entryIds = (entriesData as { id: string }[]).map((e) => e.id);
    const { data: linesData, error: e2 } = await supabase
      .from("journal_entry_lines")
      .select("gl_account_id, debit, credit")
      .in("journal_entry_id", entryIds);

    if (e2) {
      setFetchError(e2.message);
      setAssets([]);
      setLiabilities([]);
      setEquity([]);
      setTotalAssets(0);
      setTotalLiabilities(0);
      setTotalEquity(0);
      setNetIncome(0);
      setLoading(false);
      return;
    }

    const { data: accData, error: e3 } = await supabase
      .from("gl_accounts")
      .select("id, account_code, account_name, account_type")
      .in("account_type", ["asset", "liability", "equity", "income", "expense"]);

    if (e3) {
      setFetchError(e3.message);
      setAssets([]);
      setLiabilities([]);
      setEquity([]);
      setTotalAssets(0);
      setTotalLiabilities(0);
      setTotalEquity(0);
      setNetIncome(0);
      setLoading(false);
      return;
    }

    const accMap = Object.fromEntries(((accData || []) as { id: string; account_code: string; account_name: string; account_type: string }[]).map((a) => [a.id, a]));
    const byAccount: Record<string, number> = {};
    (linesData || []).forEach((l: { gl_account_id: string; debit: number; credit: number }) => {
      const acc = accMap[l.gl_account_id];
      if (!acc) return;
      if (!byAccount[l.gl_account_id]) byAccount[l.gl_account_id] = 0;
      const dr = Number(l.debit) || 0;
      const cr = Number(l.credit) || 0;
      byAccount[l.gl_account_id] += accountBalanceDelta(acc.account_type, dr, cr);
    });

    const a: AccountTotal[] = [], li: AccountTotal[] = [], eq: AccountTotal[] = [];
    let ta = 0, tl = 0, te = 0, ti = 0, tx = 0;
    Object.entries(byAccount).forEach(([id, total]) => {
      const acc = accMap[id];
      if (!acc) return;
      const row = { account_code: acc.account_code, account_name: acc.account_name, total };
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

    setAssets(a);
    setLiabilities(li);
    setEquity(eq);
    setTotalAssets(ta);
    setTotalLiabilities(tl);
    setTotalEquity(te);
    setNetIncome(ni);
    setLoading(false);
  };

  /** Assets = Liabilities + Equity + (Revenue − Expenses) when P&L is not closed into equity. */
  const totalLiabEquityAndPnL = totalLiabilities + totalEquity + netIncome;
  const balanced = Math.abs(totalAssets - totalLiabEquityAndPnL) < 0.01;

  const exportExcel = () => {
    const data: (string | number)[][] = [
      ["Balance Sheet", `As of ${asOfDate}`],
      [],
      ["Assets"],
      ["Code", "Name", "Amount"],
      ...assets.map((r) => [r.account_code, r.account_name, r.total.toFixed(2)]),
      ["", "Total Assets", totalAssets.toFixed(2)],
      [],
      ["Liabilities"],
      ["Code", "Name", "Amount"],
      ...liabilities.map((r) => [r.account_code, r.account_name, r.total.toFixed(2)]),
      ["", "Total Liabilities", totalLiabilities.toFixed(2)],
      [],
      ["Equity"],
      ["Code", "Name", "Amount"],
      ...equity.map((r) => [r.account_code, r.account_name, r.total.toFixed(2)]),
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
      subtitle: `As of ${asOfDate}`,
      filename: `balance-sheet-${asOfDate}.pdf`,
      sections: [
        {
          title: "Assets",
          head: ["Code", "Name", "Amount"],
          body: assets.map((r) => [r.account_code, r.account_name, r.total.toFixed(2)]),
        },
        {
          title: "Liabilities",
          head: ["Code", "Name", "Amount"],
          body: liabilities.map((r) => [r.account_code, r.account_name, r.total.toFixed(2)]),
        },
        {
          title: "Equity",
          head: ["Code", "Name", "Amount"],
          body: equity.map((r) => [r.account_code, r.account_name, r.total.toFixed(2)]),
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

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex flex-wrap gap-4 items-center">
          <label className="flex items-center gap-2">As of</label>
          <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="border rounded-lg px-3 py-2" />
        </div>
        {!loading && !fetchError && <AccountingExportButtons onExcel={exportExcel} onPdf={exportPdf} />}
      </div>

      {loading ? (
        <div className="text-slate-500">Loading…</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden max-w-2xl">
          <div className="p-4 border-b bg-slate-50 font-medium">Assets</div>
          <table className="w-full text-sm">
            <tbody>
              {assets.map((r) => (
                <tr key={r.account_code} className="border-t">
                  <td className="p-3 font-mono">{r.account_code}</td>
                  <td className="p-3">{r.account_name}</td>
                  <td className="p-3 text-right">{r.total.toFixed(2)}</td>
                </tr>
              ))}
              {assets.length === 0 && <tr><td colSpan={3} className="p-3 text-slate-500">No asset accounts</td></tr>}
            </tbody>
            <tfoot className="bg-slate-100 font-medium">
              <tr><td colSpan={2} className="p-3 text-right">Total Assets</td><td className="p-3 text-right">{totalAssets.toFixed(2)}</td></tr>
            </tfoot>
          </table>
          <div className="p-4 border-t border-b bg-slate-50 font-medium">Liabilities</div>
          <table className="w-full text-sm">
            <tbody>
              {liabilities.map((r) => (
                <tr key={r.account_code} className="border-t">
                  <td className="p-3 font-mono">{r.account_code}</td>
                  <td className="p-3">{r.account_name}</td>
                  <td className="p-3 text-right">{r.total.toFixed(2)}</td>
                </tr>
              ))}
              {liabilities.length === 0 && <tr><td colSpan={3} className="p-3 text-slate-500">No liability accounts</td></tr>}
            </tbody>
            <tfoot className="bg-slate-100 font-medium">
              <tr><td colSpan={2} className="p-3 text-right">Total Liabilities</td><td className="p-3 text-right">{totalLiabilities.toFixed(2)}</td></tr>
            </tfoot>
          </table>
          <div className="p-4 border-t border-b bg-slate-50 font-medium">Equity</div>
          <table className="w-full text-sm">
            <tbody>
              {equity.map((r) => (
                <tr key={r.account_code} className="border-t">
                  <td className="p-3 font-mono">{r.account_code}</td>
                  <td className="p-3">{r.account_name}</td>
                  <td className="p-3 text-right">{r.total.toFixed(2)}</td>
                </tr>
              ))}
              {equity.length === 0 && <tr><td colSpan={3} className="p-3 text-slate-500">No equity accounts</td></tr>}
            </tbody>
            <tfoot className="bg-slate-100 font-medium">
              <tr><td colSpan={2} className="p-3 text-right">Total Equity (GL accounts)</td><td className="p-3 text-right">{totalEquity.toFixed(2)}</td></tr>
            </tfoot>
          </table>
          <div className="p-4 border-t border-b bg-slate-50 font-medium text-slate-800">Net income (P&amp;L, cumulative)</div>
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-t">
                <td className="p-3 font-mono">—</td>
                <td className="p-3">Revenue less expenses (unclosed)</td>
                <td className="p-3 text-right">{netIncome.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
          <div className={`p-4 border-t font-medium ${balanced ? "text-emerald-600 bg-emerald-50" : "text-amber-600 bg-amber-50"}`}>
            Total Liabilities + Equity + Net income: {totalLiabEquityAndPnL.toFixed(2)} · Total Assets: {totalAssets.toFixed(2)}{" "}
            {balanced ? "✓ Balanced" : "(diff: " + (totalAssets - totalLiabEquityAndPnL).toFixed(2) + ")"}
          </div>
        </div>
      )}
    </div>
  );
}
