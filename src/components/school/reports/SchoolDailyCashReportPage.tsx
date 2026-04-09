import { useCallback, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { jsPDF } from "jspdf";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";
import { computeReportRange, type DateRangeKey } from "@/lib/reportsDateRange";

type DayRow = { day: string; cash: number; mobile: number; total: number };

type Props = { readOnly?: boolean };

export function SchoolDailyCashReportPage({ readOnly: _readOnly }: Props) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const [rows, setRows] = useState<DayRow[]>([]);
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

    const { data, error } = await supabase
      .from("school_payments")
      .select("amount,method,paid_at")
      .eq("organization_id", orgId)
      .in("method", ["cash", "mobile_money"])
      .gte("paid_at", fromIso)
      .lt("paid_at", toIso)
      .order("paid_at", { ascending: true });

    setErr(error?.message ?? null);
    const list = (data || []) as { amount: number; method: string; paid_at: string }[];
    const byDay = new Map<string, { cash: number; mobile: number }>();
    for (const p of list) {
      const d = new Date(p.paid_at).toISOString().slice(0, 10);
      const cur = byDay.get(d) || { cash: 0, mobile: 0 };
      const amt = Number(p.amount ?? 0);
      if (p.method === "cash") cur.cash += amt;
      else cur.mobile += amt;
      byDay.set(d, cur);
    }
    const sorted = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
    setRows(
      sorted.map(([day, v]) => ({
        day,
        cash: v.cash,
        mobile: v.mobile,
        total: v.cash + v.mobile,
      }))
    );
    setLoading(false);
  }, [orgId, dateRange, customFrom, customTo]);

  useEffect(() => {
    load();
  }, [load]);

  const grand = useMemo(() => rows.reduce((s, r) => s + r.total, 0), [rows]);

  const exportPdf = () => {
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text("Daily cash report (cash + mobile money)", 14, 18);
    let y = 30;
    rows.forEach((r) => {
      doc.text(`${r.day}  cash ${r.cash.toFixed(2)}  mobile ${r.mobile.toFixed(2)}  total ${r.total.toFixed(2)}`, 14, y);
      y += 7;
    });
    doc.text(`Grand total: ${grand.toFixed(2)}`, 14, y + 4);
    doc.save("school_daily_cash.pdf");
  };

  const maxDay = useMemo(() => Math.max(...rows.map((r) => r.total), 1), [rows]);

  if (!orgId) {
    return <p className="p-6 text-slate-600">Select an organization.</p>;
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] p-6 md:p-8 bg-gradient-to-br from-slate-50 to-indigo-50/20">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900">Daily cash report</h1>
            <PageNotes ariaLabel="Daily cash">
              <p>Cash and mobile money fee collections only, grouped by calendar day.</p>
            </PageNotes>
          </div>
          <p className="text-sm text-slate-600 mt-1">Physical cash and mobile collections — not bank transfers.</p>
        </div>
        <button type="button" onClick={exportPdf} className="app-btn-primary">
          <Download className="w-4 h-4" /> PDF
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6 flex flex-wrap gap-3 items-center">
        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value as DateRangeKey)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="today">Today</option>
          <option value="this_week">This week</option>
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
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-xl border p-4">
              <p className="text-xs text-slate-500">Days with activity</p>
              <p className="text-2xl font-bold">{rows.length}</p>
            </div>
            <div className="bg-white rounded-xl border p-4">
              <p className="text-xs text-slate-500">Total (cash + mobile)</p>
              <p className="text-2xl font-bold tabular-nums">{grand.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-2 bg-slate-50 border-b text-sm font-semibold">Visual — share of daily total</div>
            <div className="p-4 space-y-2 max-h-[360px] overflow-y-auto">
              {rows.map((r) => (
                <div key={r.day} className="flex items-center gap-3 text-sm">
                  <span className="w-28 shrink-0 text-slate-600">{r.day}</span>
                  <div className="flex-1 h-6 rounded bg-slate-100 overflow-hidden">
                    <div
                      className="h-full bg-emerald-600 rounded"
                      style={{ width: `${(r.total / maxDay) * 100}%` }}
                    />
                  </div>
                  <span className="w-24 text-right tabular-nums font-medium">{r.total.toFixed(0)}</span>
                </div>
              ))}
              {rows.length === 0 && <p className="text-slate-500 text-sm">No cash or mobile money payments in range.</p>}
            </div>
          </div>

          <table className="w-full text-sm mt-6 bg-white rounded-xl border border-slate-200 overflow-hidden">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left p-2">Date</th>
                <th className="text-right p-2">Cash</th>
                <th className="text-right p-2">Mobile money</th>
                <th className="text-right p-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.day} className="border-b border-slate-100">
                  <td className="p-2">{r.day}</td>
                  <td className="p-2 text-right tabular-nums">{r.cash.toFixed(2)}</td>
                  <td className="p-2 text-right tabular-nums">{r.mobile.toFixed(2)}</td>
                  <td className="p-2 text-right font-medium tabular-nums">{r.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
