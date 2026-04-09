import { useCallback, useEffect, useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";
import { computeReportRange, type DateRangeKey } from "@/lib/reportsDateRange";

type MonthRow = { key: string; label: string; total: number; count: number };

type Props = { readOnly?: boolean };

export function SchoolFeePaymentTrendsReportPage({ readOnly: _readOnly }: Props) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const [rows, setRows] = useState<MonthRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRangeKey>("this_year");
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

    const { data, error } = await supabase
      .from("school_payments")
      .select("amount,paid_at")
      .eq("organization_id", orgId)
      .gte("paid_at", fromIso)
      .lt("paid_at", toIso);

    setErr(error?.message ?? null);
    const list = (data || []) as { amount: number; paid_at: string }[];
    const byMonth = new Map<string, { total: number; count: number }>();
    for (const p of list) {
      const d = new Date(p.paid_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const cur = byMonth.get(key) || { total: 0, count: 0 };
      cur.total += Number(p.amount ?? 0);
      cur.count += 1;
      byMonth.set(key, cur);
    }
    const sorted = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b));
    setRows(
      sorted.map(([key, v]) => {
        const [y, m] = key.split("-");
        const label = new Date(Number(y), Number(m) - 1, 1).toLocaleString(undefined, { month: "short", year: "numeric" });
        return { key, label, total: v.total, count: v.count };
      })
    );
    setLoading(false);
  }, [orgId, dateRange, customFrom, customTo]);

  useEffect(() => {
    load();
  }, [load]);

  const max = useMemo(() => Math.max(...rows.map((r) => r.total), 1), [rows]);

  if (!orgId) {
    return <p className="p-6 text-slate-600">Select an organization.</p>;
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] p-6 md:p-8 bg-gradient-to-br from-slate-50 to-indigo-50/20">
      <div className="flex items-center gap-2 mb-2">
        <h1 className="text-2xl font-bold text-slate-900">Fee payment trends</h1>
        <PageNotes ariaLabel="Trends">
          <p>Total fee collections aggregated by calendar month within the selected range.</p>
        </PageNotes>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6 flex flex-wrap gap-3 items-center">
        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value as DateRangeKey)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="this_year">This year</option>
          <option value="last_year">Last year</option>
          <option value="this_quarter">This quarter</option>
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
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center gap-2 text-slate-700 font-medium mb-4">
            <TrendingUp className="w-5 h-5 text-indigo-600" /> Collections by month
          </div>
          <div className="space-y-4">
            {rows.map((r) => (
              <div key={r.key} className="flex items-end gap-4">
                <div className="w-28 shrink-0 text-sm text-slate-600">{r.label}</div>
                <div className="flex-1">
                  <div className="h-8 rounded-lg bg-slate-100 overflow-hidden flex items-center">
                    <div
                      className="h-full bg-indigo-500 rounded-lg min-w-[4px]"
                      style={{ width: `${(r.total / max) * 100}%` }}
                    />
                  </div>
                </div>
                <div className="w-36 text-right text-sm">
                  <span className="font-semibold tabular-nums">{r.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  <span className="text-slate-500 text-xs ml-2">({r.count} payments)</span>
                </div>
              </div>
            ))}
            {rows.length === 0 && <p className="text-slate-500 text-sm">No payments in range.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
