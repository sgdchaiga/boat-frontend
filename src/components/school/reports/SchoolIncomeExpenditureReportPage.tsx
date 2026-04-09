import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";
import { computeReportRange, type DateRangeKey } from "@/lib/reportsDateRange";

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
    const toDate = to.toISOString().slice(0, 10);

    const [payRes, expRes] = await Promise.all([
      supabase.from("school_payments").select("amount").eq("organization_id", orgId).gte("paid_at", fromIso).lt("paid_at", toIso),
      supabase.from("expenses").select("amount").eq("organization_id", orgId).gte("expense_date", fromDate).lte("expense_date", toDate),
    ]);

    setErr(payRes.error?.message || expRes.error?.message || null);
    const paySum = (payRes.data || []).reduce((s, p) => s + Number((p as { amount?: number }).amount ?? 0), 0);
    const expSum = (expRes.data || []).reduce((s, e) => s + Number((e as { amount?: number }).amount ?? 0), 0);
    setIncome(paySum);
    setExpenditure(expSum);
    setLoading(false);
  }, [orgId, dateRange, customFrom, customTo]);

  useEffect(() => {
    load();
  }, [load]);

  const net = useMemo(() => income - expenditure, [income, expenditure]);

  if (!orgId) {
    return <p className="p-6 text-slate-600">Select an organization.</p>;
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] p-6 md:p-8 bg-gradient-to-br from-slate-50 to-indigo-50/20">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <h1 className="text-2xl font-bold text-slate-900">Income &amp; expenditure</h1>
        <PageNotes ariaLabel="I&E">
          <p>
            <strong>Income</strong> is all fee payments recorded in the period. <strong>Expenditure</strong> is the sum of expense entries (Purchases → Expenses)
            in the same date range. Use the full <strong>Income Statement</strong> under Accounting for accrual-based GL analysis.
          </p>
        </PageNotes>
      </div>
      <p className="text-sm text-slate-600 mb-6">Cash-style view for school operations.</p>

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
