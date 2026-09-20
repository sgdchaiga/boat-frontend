import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Download } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";
import { computeReportRange, type DateRangeKey } from "@/lib/reportsDateRange";
import { fetchAllPages } from "@/lib/supabasePagination";

type Props = { readOnly?: boolean };

export function SchoolIncomeExpenditureReportPage({ readOnly: _readOnly }: Props) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const [income, setIncome] = useState(0);
  const [expenditure, setExpenditure] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRangeKey>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const load = useCallback(async () => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { from, to } = computeReportRange(dateRange, customFrom, customTo);
    const fromIso = from.toISOString();
    const toIso = to.toISOString();
    const fromDate = from.toISOString().slice(0, 10);
    // `to` is exclusive; expense_date is a calendar date, so compare to the
    // final included date rather than including the following business day.
    const lastIncludedDate = new Date(to.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    try {
      const [payments, expenses] = await Promise.all([
        fetchAllPages<{ amount?: number }>((start, end) => supabase.from("school_payments").select("amount").eq("organization_id", orgId).gte("paid_at", fromIso).lt("paid_at", toIso).range(start, end)),
        fetchAllPages<{ amount?: number }>((start, end) => supabase.from("expenses").select("amount").eq("organization_id", orgId).gte("expense_date", fromDate).lte("expense_date", lastIncludedDate).range(start, end)),
      ]);
      setErr(null);
      const paySum = payments.reduce((s, p) => s + Number(p.amount ?? 0), 0);
      const expSum = expenses.reduce((s, e) => s + Number(e.amount ?? 0), 0);
      setIncome(paySum);
      setExpenditure(expSum);
    } catch (error) {
      setIncome(0); setExpenditure(0); setErr(error instanceof Error ? error.message : "Failed to load the cash summary.");
    }
    setLoading(false);
  }, [orgId, dateRange, customFrom, customTo]);

  useEffect(() => {
    load();
  }, [load]);

  const net = useMemo(() => income - expenditure, [income, expenditure]);
  const exportCsv = () => { const csv = `metric,amount\nfee_collections,${income}\nrecorded_expenses,${expenditure}\nnet,${net}\n`; const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const a = document.createElement("a"); a.href = url; a.download = "school_cash_fee_summary.csv"; a.click(); URL.revokeObjectURL(url); };

  if (!orgId) {
    return <p className="p-6 text-slate-600">Select an organization.</p>;
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] p-6 md:p-8 bg-gradient-to-br from-slate-50 to-indigo-50/20">
      <div className="flex flex-wrap items-center gap-2 mb-2">
            <h1 className="text-2xl font-bold text-slate-900">Fee collections &amp; expenditure</h1>
        <PageNotes ariaLabel="I&E">
          <p>
            <strong>Income</strong> is all fee payments recorded in the period. <strong>Expenditure</strong> is the sum of expense entries (Purchases → Expenses)
            in the same date range. Use the full <strong>Income Statement</strong> under Accounting for accrual-based GL analysis.
          </p>
        </PageNotes>
      </div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-slate-600">Cash-style view: fee payments and recorded expenses only. Use the Income Statement for complete ledger income.</p><button type="button" onClick={exportCsv} disabled={loading || !!err} className="app-btn-secondary"><Download className="w-4 h-4" /> CSV</button></div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6 flex flex-wrap gap-3 items-center">
        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value as DateRangeKey)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="this_month">This month</option>
          <option value="this_quarter">This quarter</option>
          <option value="this_year">This year</option>
          <option value="last_month">Last month</option>
          <option value="custom">Custom</option>
        </select>
        {dateRange === "custom" && (
          <>
            <input type="date" className="border rounded-lg px-2 py-2 text-sm" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <span className="text-slate-500">to</span>
            <input type="date" className="border rounded-lg px-2 py-2 text-sm" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </>
        )}
      </div>

      {err && <p className="text-red-600 text-sm mb-4">{err}</p>}

      {loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-6">
            <div className="flex items-center gap-2 text-emerald-800 font-semibold mb-2">
              <ArrowUpRight className="w-5 h-5" /> Income (fee collections)
            </div>
            <p className="text-3xl font-bold tabular-nums text-slate-900">{income.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
          </div>
          <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-6">
            <div className="flex items-center gap-2 text-rose-800 font-semibold mb-2">
              <ArrowDownRight className="w-5 h-5" /> Expenditure (expenses)
            </div>
            <p className="text-3xl font-bold tabular-nums text-slate-900">{expenditure.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <p className="text-slate-600 font-medium mb-2">Net (income − expenditure)</p>
            <p className={`text-3xl font-bold tabular-nums ${net >= 0 ? "text-emerald-700" : "text-red-700"}`}>
              {net.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
