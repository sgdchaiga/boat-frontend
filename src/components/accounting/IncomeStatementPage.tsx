import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { computeRangeInTimezone, type DateRangeKey } from "../../lib/timezone";
import { downloadXlsx, exportAccountingPdf, formatCurrency } from "../../lib/accountingReportExport";
import { AccountingExportButtons } from "./AccountingExportButtons";
import { PageNotes } from "../common/PageNotes";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId, filterJournalLinesByOrganizationId } from "../../lib/supabaseOrgFilter";
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";

type AccountTotal = { account_id: string; account_code: string; account_name: string; total: number };
type TrendPoint = { period: string; revenue: number; expenses: number };
type ExpenseSlice = { name: string; value: number };
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
type TotalsSnapshot = {
  revenueRows: AccountTotal[];
  expenseRows: AccountTotal[];
  totalRevenue: number;
  totalExpenses: number;
  branches: string[];
  trend: TrendPoint[];
  expenseBreakdown: ExpenseSlice[];
};

export function IncomeStatementPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const [dateRange, setDateRange] = useState<DateRangeKey>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [debouncedCustomFrom, setDebouncedCustomFrom] = useState("");
  const [debouncedCustomTo, setDebouncedCustomTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [revenue, setRevenue] = useState<AccountTotal[]>([]);
  const [expenses, setExpenses] = useState<AccountTotal[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalExpenses, setTotalExpenses] = useState(0);
  const [compareRange, setCompareRange] = useState<"none" | "previous_period" | "same_period_last_year">("none");
  const [previousTotalRevenue, setPreviousTotalRevenue] = useState(0);
  const [previousTotalExpenses, setPreviousTotalExpenses] = useState(0);
  const [previousLabel, setPreviousLabel] = useState("Previous");
  const [companyName, setCompanyName] = useState("Business");
  const [trendData, setTrendData] = useState<TrendPoint[]>([]);
  const [expenseBreakdown, setExpenseBreakdown] = useState<ExpenseSlice[]>([]);
  const [drillAccount, setDrillAccount] = useState<{ id: string; code: string; name: string; type: "income" | "expense" } | null>(null);
  const [drillRows, setDrillRows] = useState<DrillLine[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);
  const totalsCacheRef = useRef<Map<string, TotalsSnapshot>>(new Map());
  const requestSeqRef = useRef(0);

  useEffect(() => {
    fetchData();
  }, [dateRange, debouncedCustomFrom, debouncedCustomTo, compareRange]);

  useEffect(() => {
    if (dateRange !== "custom") {
      setDebouncedCustomFrom(customFrom);
      setDebouncedCustomTo(customTo);
      return;
    }
    const t = window.setTimeout(() => {
      setDebouncedCustomFrom(customFrom);
      setDebouncedCustomTo(customTo);
    }, 350);
    return () => window.clearTimeout(t);
  }, [dateRange, customFrom, customTo]);

  useEffect(() => {
    if (!orgId) {
      setCompanyName("Business");
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.from("organizations").select("name").eq("id", orgId).maybeSingle();
      if (cancelled) return;
      const name = (data as { name?: string } | null)?.name?.trim();
      setCompanyName(name || "Business");
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const resetData = () => {
    setRevenue([]);
    setExpenses([]);
    setTotalRevenue(0);
    setTotalExpenses(0);
  };

  const fetchData = async () => {
    const requestSeq = ++requestSeqRef.current;
    setLoading(true);
    setFetchError(null);
    const effectiveCustomFrom = dateRange === "custom" ? debouncedCustomFrom : customFrom;
    const effectiveCustomTo = dateRange === "custom" ? debouncedCustomTo : customTo;
    const { from, to } = computeRangeInTimezone(dateRange, effectiveCustomFrom, effectiveCustomTo);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);

    if (!orgId && !superAdmin) {
      setFetchError("Missing organization on your staff profile. Contact admin to link your account.");
      resetData();
      setLoading(false);
      return;
    }

    const fetchTotalsForRange = async (fromDate: string, toDate: string) => {
      const cacheKey = [orgId || "platform", superAdmin ? "super" : "tenant", fromDate, toDate].join("|");
      const cached = totalsCacheRef.current.get(cacheKey);
      if (cached) return cached;

      const linesQuery = supabase
        .from("journal_entry_lines")
        .select(
          "debit, credit, gl_accounts!inner(id, account_code, account_name, account_type), journal_entries!inner(entry_date)"
        )
        .gte("journal_entries.entry_date", fromDate)
        .lte("journal_entries.entry_date", toDate)
        .eq("journal_entries.is_posted", true)
        .in("gl_accounts.account_type", ["income", "expense"]);

      const [linesRes, accRes] = await Promise.all([
        filterJournalLinesByOrganizationId(linesQuery, orgId, superAdmin),
        filterByOrganizationId(
          supabase
            .from("gl_accounts")
            .select("id, account_code, account_name, account_type")
            .in("account_type", ["income", "expense"])
            .eq("is_active", true)
            .order("account_code"),
          orgId,
          superAdmin
        ),
      ]);

      if (linesRes.error) throw new Error(linesRes.error.message);
      if (accRes.error) throw new Error(accRes.error.message);

      const accounts = (accRes.data || []) as { id: string; account_code: string; account_name: string; account_type: string }[];
      const accMap: Record<string, { id: string; account_code: string; account_name: string; account_type: string }> = Object.fromEntries(
        accounts.map((a) => [a.id, a])
      );
      const byAccount: Record<string, number> = {};
      (linesRes.data || []).forEach((l: {
        debit: number;
        credit: number;
        gl_accounts: { id: string; account_code: string; account_name: string; account_type: string } | null;
      }) => {
        const acc = l.gl_accounts;
        if (!acc) return;
        accMap[acc.id] = acc;
        if (!byAccount[acc.id]) byAccount[acc.id] = 0;
        if (acc.account_type === "income") byAccount[acc.id] += (Number(l.credit) || 0) - (Number(l.debit) || 0);
        else byAccount[acc.id] += (Number(l.debit) || 0) - (Number(l.credit) || 0);
      });
      accounts.forEach((acc) => {
        if (!(acc.id in byAccount)) byAccount[acc.id] = 0;
      });

      const rev: AccountTotal[] = [];
      const exp: AccountTotal[] = [];
      let tr = 0, te = 0;
      const byPeriod: Record<string, { revenue: number; expenses: number }> = {};
      Object.entries(byAccount).forEach(([id, total]) => {
        const acc = accMap[id];
        if (!acc) return;
        const row = { account_id: acc.id, account_code: acc.account_code, account_name: acc.account_name, total };
        if (acc.account_type === "income") {
          rev.push(row);
          tr += total;
        } else {
          exp.push(row);
          te += total;
        }
      });
      (linesRes.data || []).forEach((l: {
        debit: number;
        credit: number;
        gl_accounts: { account_type: string } | null;
        journal_entries: { entry_date: string } | null;
      }) => {
        const accType = l.gl_accounts?.account_type;
        const entryDate = l.journal_entries?.entry_date || "";
        if (!entryDate || (accType !== "income" && accType !== "expense")) return;
        const period = entryDate.slice(0, 7);
        if (!byPeriod[period]) byPeriod[period] = { revenue: 0, expenses: 0 };
        if (accType === "income") byPeriod[period].revenue += (Number(l.credit) || 0) - (Number(l.debit) || 0);
        if (accType === "expense") byPeriod[period].expenses += (Number(l.debit) || 0) - (Number(l.credit) || 0);
      });
      rev.sort((a, b) => a.account_code.localeCompare(b.account_code));
      exp.sort((a, b) => a.account_code.localeCompare(b.account_code));
      const trend = Object.keys(byPeriod)
        .sort()
        .map((period) => ({
          period,
          revenue: byPeriod[period].revenue,
          expenses: byPeriod[period].expenses,
        }));
      const expenseBreakdown = exp
        .map((r) => ({ name: `${r.account_code} ${r.account_name}`.trim(), value: Number(r.total) || 0 }))
        .filter((r) => Math.abs(r.value) > 0.0001)
        .sort((a, b) => b.value - a.value)
        .slice(0, 12);

      const snapshot = {
        revenueRows: rev,
        expenseRows: exp,
        totalRevenue: tr,
        totalExpenses: te,
        branches: [] as string[],
        trend,
        expenseBreakdown,
      };
      totalsCacheRef.current.set(cacheKey, snapshot);
      return snapshot;
    };
    try {
      const currentRes = await fetchTotalsForRange(fromStr, toStr);

      if (requestSeq !== requestSeqRef.current) return;
      setRevenue(currentRes.revenueRows);
      setExpenses(currentRes.expenseRows);
      setTotalRevenue(currentRes.totalRevenue);
      setTotalExpenses(currentRes.totalExpenses);
      setTrendData(currentRes.trend);
      setExpenseBreakdown(currentRes.expenseBreakdown);

      if (compareRange === "none") {
        setPreviousTotalRevenue(0);
        setPreviousTotalExpenses(0);
        setPreviousLabel("Previous");
        return;
      }

      const msPerDay = 24 * 60 * 60 * 1000;
      let prevFrom = new Date(fromStr + "T00:00:00");
      let prevTo = new Date(toStr + "T00:00:00");
      if (compareRange === "previous_period") {
        const daySpan = Math.floor((prevTo.getTime() - prevFrom.getTime()) / msPerDay) + 1;
        prevFrom = new Date(prevFrom.getTime() - daySpan * msPerDay);
        prevTo = new Date(prevTo.getTime() - daySpan * msPerDay);
        setPreviousLabel("Previous period");
      } else {
        prevFrom.setFullYear(prevFrom.getFullYear() - 1);
        prevTo.setFullYear(prevTo.getFullYear() - 1);
        setPreviousLabel("Same period last year");
      }

      const prevRes = await fetchTotalsForRange(prevFrom.toISOString().slice(0, 10), prevTo.toISOString().slice(0, 10));
      if (requestSeq !== requestSeqRef.current) return;
      setPreviousTotalRevenue(prevRes.totalRevenue);
      setPreviousTotalExpenses(prevRes.totalExpenses);
    } catch (e) {
      if (requestSeq !== requestSeqRef.current) return;
      setFetchError(e instanceof Error ? e.message : String(e));
      setPreviousTotalRevenue(0);
      setPreviousTotalExpenses(0);
    } finally {
      if (requestSeq !== requestSeqRef.current) return;
      setLoading(false);
    }
  };

  const netIncome = totalRevenue - totalExpenses;
  const previousNetIncome = previousTotalRevenue - previousTotalExpenses;
  const hasNegativeRevenue = revenue.some((r) => r.total < 0);
  const hasNegativeExpense = expenses.some((e) => e.total < 0);
  const hasRenderedData =
    revenue.length > 0 ||
    expenses.length > 0 ||
    totalRevenue !== 0 ||
    totalExpenses !== 0 ||
    compareRange !== "none";
  const initialLoading = loading && !hasRenderedData;
  const refreshing = loading && hasRenderedData;

  const periodLabel = useMemo(() => {
    const { from, to } = computeRangeInTimezone(dateRange, customFrom, customTo);
    return `${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}`;
  }, [dateRange, customFrom, customTo]);

  const fileStamp = useMemo(() => computeRangeInTimezone(dateRange, customFrom, customTo).to.toISOString().slice(0, 10), [dateRange, customFrom, customTo]);
  const pieColors = ["#0ea5e9", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#14b8a6", "#6366f1", "#84cc16", "#ec4899", "#22c55e", "#f97316", "#64748b"];

  const openDrilldown = async (account: { id: string; code: string; name: string; type: "income" | "expense" }) => {
    setDrillAccount(account);
    setDrillRows([]);
    setDrillError(null);
    setDrillLoading(true);
    try {
      const effectiveCustomFrom = dateRange === "custom" ? debouncedCustomFrom : customFrom;
      const effectiveCustomTo = dateRange === "custom" ? debouncedCustomTo : customTo;
      const { from, to } = computeRangeInTimezone(dateRange, effectiveCustomFrom, effectiveCustomTo);
      const fromStr = from.toISOString().slice(0, 10);
      const toStr = to.toISOString().slice(0, 10);
      const q = supabase
        .from("journal_entry_lines")
        .select(
          "id, debit, credit, line_description, journal_entries!inner(id, entry_date, description, transaction_id, reference_type), gl_accounts!inner(id)"
        )
        .eq("gl_account_id", account.id)
        .gte("journal_entries.entry_date", fromStr)
        .lte("journal_entries.entry_date", toStr)
        .eq("journal_entries.is_posted", true)
        .order("entry_date", { ascending: false, referencedTable: "journal_entries" });
      const { data, error } = await filterJournalLinesByOrganizationId(q, orgId, superAdmin);
      if (error) throw new Error(error.message);
      const rows = ((data || []) as Array<{
        id: string;
        debit: number;
        credit: number;
        line_description: string | null;
        journal_entries: { entry_date: string; description: string; transaction_id: string | null; reference_type: string | null } | null;
      }>).map((r) => ({
        id: r.id,
        entry_date: r.journal_entries?.entry_date || "",
        description: r.journal_entries?.description || "",
        transaction_id: r.journal_entries?.transaction_id ?? null,
        reference_type: r.journal_entries?.reference_type ?? null,
        debit: Number(r.debit) || 0,
        credit: Number(r.credit) || 0,
        line_description: r.line_description,
      }));
      setDrillRows(rows);
    } catch (e) {
      setDrillError(e instanceof Error ? e.message : String(e));
    } finally {
      setDrillLoading(false);
    }
  };

  const exportExcel = () => {
    const data: (string | number)[][] = [
      ["Income Statement", periodLabel],
      [],
      ["Revenue"],
      ["Code", "Name", "Amount"],
      ...revenue.map((r) => [r.account_code, r.account_name, formatCurrency(r.total, { currency: "UGX", locale: "en-UG" })]),
      ["", "Total Revenue", formatCurrency(totalRevenue, { currency: "UGX", locale: "en-UG" })],
      [],
      ["Expenses"],
      ["Code", "Name", "Amount"],
      ...expenses.map((e) => [e.account_code, e.account_name, formatCurrency(e.total, { currency: "UGX", locale: "en-UG" })]),
      ["", "Total Expenses", formatCurrency(totalExpenses, { currency: "UGX", locale: "en-UG" })],
      [],
      ["", "Net Income", formatCurrency(netIncome, { currency: "UGX", locale: "en-UG" })],
    ];
    downloadXlsx(`income-statement-${fileStamp}.xlsx`, data, { companyName, sheetName: "Income Statement" });
  };

  const exportPdf = () => {
    exportAccountingPdf({
      title: "Income Statement",
      subtitle: periodLabel,
      filename: `income-statement-${fileStamp}.pdf`,
      companyName,
      sections: [
        {
          title: "Revenue",
          head: ["Code", "Name", "Amount"],
          body: revenue.map((r) => [r.account_code, r.account_name, formatCurrency(r.total, { currency: "UGX", locale: "en-UG" })]),
        },
        {
          title: "Expenses",
          head: ["Code", "Name", "Amount"],
          body: expenses.map((e) => [e.account_code, e.account_name, formatCurrency(e.total, { currency: "UGX", locale: "en-UG" })]),
        },
      ],
      footerLines: [
        `Total revenue: ${formatCurrency(totalRevenue, { currency: "UGX", locale: "en-UG" })}  Total expenses: ${formatCurrency(totalExpenses, { currency: "UGX", locale: "en-UG" })}`,
        `Net income: ${formatCurrency(netIncome, { currency: "UGX", locale: "en-UG" })}`,
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
            <p className="mt-2">
              This report uses all posted journal lines for income and expense accounts (no per-branch filter unless your database has optional{" "}
              <code className="text-xs">journal_entry_lines.dimensions</code>).
            </p>
          </PageNotes>
        </div>
      </div>

      {fetchError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800" role="alert">
          {fetchError}
        </div>
      )}
      {!fetchError && (hasNegativeRevenue || hasNegativeExpense) && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900" role="alert">
          Negative balances detected in {hasNegativeRevenue ? "revenue" : ""}
          {hasNegativeRevenue && hasNegativeExpense ? " and " : ""}
          {hasNegativeExpense ? "expense" : ""} accounts. Please review source journals for potential posting errors.
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
          <select
            value={compareRange}
            onChange={(e) => setCompareRange(e.target.value as "none" | "previous_period" | "same_period_last_year")}
            className="border rounded-lg px-3 py-2"
          >
            <option value="none">No comparison</option>
            <option value="previous_period">Compare with previous period</option>
            <option value="same_period_last_year">Compare with same period last year</option>
          </select>
        </div>
        {!loading && !fetchError && <AccountingExportButtons onExcel={exportExcel} onPdf={exportPdf} />}
      </div>

      {initialLoading ? (
        <div className="space-y-4 max-w-2xl">
          <div className="h-10 w-56 rounded-lg bg-slate-200 animate-pulse" />
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="h-5 w-40 rounded bg-slate-200 animate-pulse" />
            <div className="h-4 w-full rounded bg-slate-100 animate-pulse" />
            <div className="h-4 w-full rounded bg-slate-100 animate-pulse" />
            <div className="h-4 w-3/4 rounded bg-slate-100 animate-pulse" />
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="h-5 w-40 rounded bg-slate-200 animate-pulse" />
            <div className="h-4 w-full rounded bg-slate-100 animate-pulse" />
            <div className="h-4 w-full rounded bg-slate-100 animate-pulse" />
            <div className="h-4 w-3/4 rounded bg-slate-100 animate-pulse" />
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden max-w-2xl">
          {refreshing && (
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
              Refreshing report...
            </div>
          )}
          <div className="p-4 border-b bg-slate-50 font-medium">Revenue</div>
          <table className="w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="p-3 text-left">Code</th>
                <th className="p-3 text-left">Account</th>
                <th className="p-3 text-right">% of Revenue</th>
                <th className="p-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {revenue.map((r) => (
                <tr key={r.account_code} className="border-t">
                  <td className="p-3 font-mono">{r.account_code}</td>
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={() => openDrilldown({ id: r.account_id, code: r.account_code, name: r.account_name, type: "income" })}
                      className="text-left text-blue-700 hover:underline"
                    >
                      {r.account_name}
                    </button>
                  </td>
                  <td className="p-3 text-right text-slate-600">
                    {totalRevenue !== 0 ? `${((r.total / totalRevenue) * 100).toFixed(1)}%` : "0.0%"}
                  </td>
                  <td className={`p-3 text-right ${r.total < 0 ? "text-rose-700 font-medium" : ""}`}>
                    {formatCurrency(r.total, { currency: "UGX", locale: "en-UG" })}
                  </td>
                </tr>
              ))}
              {revenue.length === 0 && <tr><td colSpan={4} className="p-3 text-slate-500">No revenue accounts</td></tr>}
            </tbody>
            <tfoot className="bg-slate-100 font-medium">
              <tr>
                <td colSpan={3} className="p-3 text-right">Total Revenue</td>
                <td className="p-3 text-right">{formatCurrency(totalRevenue, { currency: "UGX", locale: "en-UG" })}</td>
              </tr>
            </tfoot>
          </table>
          <div className="p-4 border-t border-b bg-slate-50 font-medium">Expenses</div>
          <table className="w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="p-3 text-left">Code</th>
                <th className="p-3 text-left">Account</th>
                <th className="p-3 text-right">% of Expenses</th>
                <th className="p-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.account_code} className="border-t">
                  <td className="p-3 font-mono">{e.account_code}</td>
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={() => openDrilldown({ id: e.account_id, code: e.account_code, name: e.account_name, type: "expense" })}
                      className="text-left text-blue-700 hover:underline"
                    >
                      {e.account_name}
                    </button>
                  </td>
                  <td className="p-3 text-right text-slate-600">
                    {totalExpenses !== 0 ? `${((e.total / totalExpenses) * 100).toFixed(1)}%` : "0.0%"}
                  </td>
                  <td className={`p-3 text-right ${e.total < 0 ? "text-rose-700 font-medium" : ""}`}>
                    {formatCurrency(e.total, { currency: "UGX", locale: "en-UG" })}
                  </td>
                </tr>
              ))}
              {expenses.length === 0 && <tr><td colSpan={4} className="p-3 text-slate-500">No expense accounts</td></tr>}
            </tbody>
            <tfoot className="bg-slate-100 font-medium">
              <tr>
                <td colSpan={3} className="p-3 text-right">Total Expenses</td>
                <td className="p-3 text-right">{formatCurrency(totalExpenses, { currency: "UGX", locale: "en-UG" })}</td>
              </tr>
            </tfoot>
          </table>
          <div className="p-4 border-t bg-emerald-50 font-bold text-lg">
            <span className="inline-block w-full text-right">
              Net Income: {formatCurrency(netIncome, { currency: "UGX", locale: "en-UG" })}
            </span>
          </div>
        </div>
        
      )}
      {!fetchError && compareRange !== "none" && !initialLoading && (
        <div className="mt-6 bg-white rounded-xl border border-slate-200 overflow-hidden max-w-2xl">
          {refreshing && (
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
              Refreshing comparison...
            </div>
          )}
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
                <td className="p-3">Revenue</td>
                <td className="p-3 text-right">{formatCurrency(totalRevenue, { currency: "UGX", locale: "en-UG" })}</td>
                <td className="p-3 text-right">{formatCurrency(previousTotalRevenue, { currency: "UGX", locale: "en-UG" })}</td>
              </tr>
              <tr className="border-t">
                <td className="p-3">Expenses</td>
                <td className="p-3 text-right">{formatCurrency(totalExpenses, { currency: "UGX", locale: "en-UG" })}</td>
                <td className="p-3 text-right">{formatCurrency(previousTotalExpenses, { currency: "UGX", locale: "en-UG" })}</td>
              </tr>
              <tr className="border-t font-medium bg-slate-50">
                <td className="p-3">Net income</td>
                <td className="p-3 text-right">{formatCurrency(netIncome, { currency: "UGX", locale: "en-UG" })}</td>
                <td className="p-3 text-right">{formatCurrency(previousNetIncome, { currency: "UGX", locale: "en-UG" })}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {!initialLoading && !fetchError && (
        <div className="mt-6 grid grid-cols-1 xl:grid-cols-2 gap-6 max-w-6xl">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="font-semibold text-slate-800 mb-3">Revenue vs Expenses Trend</h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" />
                  <YAxis />
                  <Tooltip formatter={(v: number) => formatCurrency(Number(v) || 0, { currency: "UGX", locale: "en-UG" })} />
                  <Legend />
                  <Line type="monotone" dataKey="revenue" stroke="#16a34a" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="expenses" stroke="#7c3aed" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="font-semibold text-slate-800 mb-3">Expense Breakdown</h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={expenseBreakdown} dataKey="value" nameKey="name" outerRadius={100} labelLine={false} label={({ percent = 0 }) => `${(percent * 100).toFixed(1)}%`}>
                    {expenseBreakdown.map((_, idx) => (
                      <Cell key={`slice-${idx}`} fill={pieColors[idx % pieColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatCurrency(Number(v) || 0, { currency: "UGX", locale: "en-UG" })} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
      {drillAccount && (
        <div className="fixed inset-0 z-50 bg-black/40 p-4 overflow-y-auto">
          <div className="mx-auto mt-8 w-full max-w-5xl rounded-xl bg-white border border-slate-200 shadow-xl">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Drill-down: {drillAccount.code} {drillAccount.name}
                </h3>
                <p className="text-xs text-slate-500 capitalize">{drillAccount.type} transactions in selected period/filters</p>
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
                <div className="overflow-auto max-h-[60vh]">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-100 sticky top-0">
                      <tr>
                        <th className="p-2 text-left">Date</th>
                        <th className="p-2 text-left">Description</th>
                        <th className="p-2 text-left">Ref</th>
                        <th className="p-2 text-right">Debit</th>
                        <th className="p-2 text-right">Credit</th>
                        <th className="p-2 text-right">Impact</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drillRows.map((r) => {
                        const impact = drillAccount.type === "income" ? r.credit - r.debit : r.debit - r.credit;
                        return (
                          <tr key={r.id} className="border-t">
                            <td className="p-2">{r.entry_date}</td>
                            <td className="p-2">
                              <div>{r.description || "—"}</div>
                              {r.line_description ? <div className="text-xs text-slate-500">{r.line_description}</div> : null}
                            </td>
                            <td className="p-2 text-xs text-slate-600">{r.reference_type || "—"} {r.transaction_id ? `#${r.transaction_id}` : ""}</td>
                            <td className="p-2 text-right">{formatCurrency(r.debit, { currency: "UGX", locale: "en-UG" })}</td>
                            <td className="p-2 text-right">{formatCurrency(r.credit, { currency: "UGX", locale: "en-UG" })}</td>
                            <td className="p-2 text-right font-medium">{formatCurrency(impact, { currency: "UGX", locale: "en-UG" })}</td>
                          </tr>
                        );
                      })}
                      {drillRows.length === 0 && (
                        <tr>
                          <td colSpan={6} className="p-4 text-center text-slate-500">
                            No transactions found for this account and filter.
                          </td>
                        </tr>
                      )}
                    </tbody>
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
