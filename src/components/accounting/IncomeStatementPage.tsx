import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { computeRangeInTimezone, type DateRangeKey } from "../../lib/timezone";
import { downloadCsv, exportAccountingPdf } from "../../lib/accountingReportExport";
import { AccountingExportButtons } from "./AccountingExportButtons";
import { PageNotes } from "../common/PageNotes";

type AccountTotal = { account_code: string; account_name: string; total: number };

export function IncomeStatementPage() {
  const [dateRange, setDateRange] = useState<DateRangeKey>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [revenue, setRevenue] = useState<AccountTotal[]>([]);
  const [expenses, setExpenses] = useState<AccountTotal[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalExpenses, setTotalExpenses] = useState(0);

  useEffect(() => {
    fetchData();
  }, [dateRange, customFrom, customTo]);

  const fetchData = async () => {
    setLoading(true);
    setFetchError(null);
    const { from, to } = computeRangeInTimezone(dateRange, customFrom, customTo);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);

    const { data: entriesData, error: e1 } = await supabase
      .from("journal_entries")
      .select("id")
      .gte("entry_date", fromStr)
      .lte("entry_date", toStr);

    if (e1) {
      setFetchError(e1.message);
      setRevenue([]);
      setExpenses([]);
      setTotalRevenue(0);
      setTotalExpenses(0);
      setLoading(false);
      return;
    }

    if (!entriesData?.length) {
      setRevenue([]);
      setExpenses([]);
      setTotalRevenue(0);
      setTotalExpenses(0);
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
      setRevenue([]);
      setExpenses([]);
      setTotalRevenue(0);
      setTotalExpenses(0);
      setLoading(false);
      return;
    }

    const { data: accData, error: e3 } = await supabase
      .from("gl_accounts")
      .select("id, account_code, account_name, account_type")
      .in("account_type", ["income", "expense"]);

    if (e3) {
      setFetchError(e3.message);
      setRevenue([]);
      setExpenses([]);
      setTotalRevenue(0);
      setTotalExpenses(0);
      setLoading(false);
      return;
    }

    const accMap = Object.fromEntries(((accData || []) as { id: string; account_code: string; account_name: string; account_type: string }[]).map((a) => [a.id, a]));
    const byAccount: Record<string, number> = {};
    (linesData || []).forEach((l: { gl_account_id: string; debit: number; credit: number }) => {
      const acc = accMap[l.gl_account_id];
      if (!acc) return;
      if (!byAccount[l.gl_account_id]) byAccount[l.gl_account_id] = 0;
      if (acc.account_type === "income") byAccount[l.gl_account_id] += (Number(l.credit) || 0) - (Number(l.debit) || 0);
      else byAccount[l.gl_account_id] += (Number(l.debit) || 0) - (Number(l.credit) || 0);
    });

    const rev: AccountTotal[] = [];
    const exp: AccountTotal[] = [];
    let tr = 0, te = 0;
    Object.entries(byAccount).forEach(([id, total]) => {
      const acc = accMap[id];
      if (!acc) return;
      const row = { account_code: acc.account_code, account_name: acc.account_name, total };
      if (acc.account_type === "income") { rev.push(row); tr += total; }
      else { exp.push(row); te += total; }
    });
    rev.sort((a, b) => a.account_code.localeCompare(b.account_code));
    exp.sort((a, b) => a.account_code.localeCompare(b.account_code));

    setRevenue(rev);
    setExpenses(exp);
    setTotalRevenue(tr);
    setTotalExpenses(te);
    setLoading(false);
  };

  const netIncome = totalRevenue - totalExpenses;

  const periodLabel = useMemo(() => {
    const { from, to } = computeRangeInTimezone(dateRange, customFrom, customTo);
    return `${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}`;
  }, [dateRange, customFrom, customTo]);

  const fileStamp = useMemo(() => computeRangeInTimezone(dateRange, customFrom, customTo).to.toISOString().slice(0, 10), [dateRange, customFrom, customTo]);

  const exportExcel = () => {
    const data: (string | number)[][] = [
      ["Income Statement", periodLabel],
      [],
      ["Revenue"],
      ["Code", "Name", "Amount"],
      ...revenue.map((r) => [r.account_code, r.account_name, r.total.toFixed(2)]),
      ["", "Total Revenue", totalRevenue.toFixed(2)],
      [],
      ["Expenses"],
      ["Code", "Name", "Amount"],
      ...expenses.map((e) => [e.account_code, e.account_name, e.total.toFixed(2)]),
      ["", "Total Expenses", totalExpenses.toFixed(2)],
      [],
      ["", "Net Income", netIncome.toFixed(2)],
    ];
    downloadCsv(`income-statement-${fileStamp}.csv`, data);
  };

  const exportPdf = () => {
    exportAccountingPdf({
      title: "Income Statement",
      subtitle: periodLabel,
      filename: `income-statement-${fileStamp}.pdf`,
      sections: [
        {
          title: "Revenue",
          head: ["Code", "Name", "Amount"],
          body: revenue.map((r) => [r.account_code, r.account_name, r.total.toFixed(2)]),
        },
        {
          title: "Expenses",
          head: ["Code", "Name", "Amount"],
          body: expenses.map((e) => [e.account_code, e.account_name, e.total.toFixed(2)]),
        },
      ],
      footerLines: [
        `Total revenue: ${totalRevenue.toFixed(2)}  Total expenses: ${totalExpenses.toFixed(2)}`,
        `Net income: ${netIncome.toFixed(2)}`,
      ],
    });
  };

  return (
    <div className="p-6 md:p-8">
      <div className="mb-8">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-bold text-slate-900">Income Statement</h1>
          <PageNotes ariaLabel="Income statement help">
            <p>
              Revenue and expenses (P&amp;L) only. A sale appears under revenue; a purchase bill appears under expense. Cash and payables are on the
              balance sheet and cash flow, not here.
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
          <select value={dateRange} onChange={(e) => setDateRange(e.target.value as DateRangeKey)} className="border rounded-lg px-3 py-2">
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="this_week">This week</option>
            <option value="this_month">This month</option>
            <option value="last_month">Last month</option>
            <option value="custom">Custom</option>
          </select>
          {dateRange === "custom" && (
            <>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="border rounded-lg px-3 py-2" />
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="border rounded-lg px-3 py-2" />
            </>
          )}
        </div>
        {!loading && !fetchError && <AccountingExportButtons onExcel={exportExcel} onPdf={exportPdf} />}
      </div>

      {loading ? (
        <div className="text-slate-500">Loading…</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden max-w-2xl">
          <div className="p-4 border-b bg-slate-50 font-medium">Revenue</div>
          <table className="w-full text-sm">
            <tbody>
              {revenue.map((r) => (
                <tr key={r.account_code} className="border-t">
                  <td className="p-3 font-mono">{r.account_code}</td>
                  <td className="p-3">{r.account_name}</td>
                  <td className="p-3 text-right">{r.total.toFixed(2)}</td>
                </tr>
              ))}
              {revenue.length === 0 && <tr><td colSpan={3} className="p-3 text-slate-500">No revenue accounts</td></tr>}
            </tbody>
            <tfoot className="bg-slate-100 font-medium">
              <tr><td colSpan={2} className="p-3 text-right">Total Revenue</td><td className="p-3 text-right">{totalRevenue.toFixed(2)}</td></tr>
            </tfoot>
          </table>
          <div className="p-4 border-t border-b bg-slate-50 font-medium">Expenses</div>
          <table className="w-full text-sm">
            <tbody>
              {expenses.map((e) => (
                <tr key={e.account_code} className="border-t">
                  <td className="p-3 font-mono">{e.account_code}</td>
                  <td className="p-3">{e.account_name}</td>
                  <td className="p-3 text-right">{e.total.toFixed(2)}</td>
                </tr>
              ))}
              {expenses.length === 0 && <tr><td colSpan={3} className="p-3 text-slate-500">No expense accounts</td></tr>}
            </tbody>
            <tfoot className="bg-slate-100 font-medium">
              <tr><td colSpan={2} className="p-3 text-right">Total Expenses</td><td className="p-3 text-right">{totalExpenses.toFixed(2)}</td></tr>
            </tfoot>
          </table>
          <div className="p-4 border-t bg-emerald-50 font-bold text-lg">
            <span className="inline-block w-full text-right">Net Income: {netIncome.toFixed(2)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
