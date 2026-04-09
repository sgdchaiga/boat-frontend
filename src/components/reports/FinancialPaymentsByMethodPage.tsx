import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { computeRangeInTimezone, type DateRangeKey } from "../../lib/timezone";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import { formatPaymentMethodLabel } from "../../lib/paymentMethod";
import { PageNotes } from "../common/PageNotes";

interface PaymentMethodRow {
  method: string;
  total: number;
  count: number;
}

export function FinancialPaymentsByMethodPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [dateRange, setDateRange] = useState<DateRangeKey>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PaymentMethodRow[]>([]);

  useEffect(() => {
    loadData();
  }, [dateRange, customFrom, customTo, orgId, superAdmin]);

  const loadData = async () => {
    setLoading(true);
    try {
      const { from, to } = computeRangeInTimezone(dateRange, customFrom, customTo);
      const { data } = await filterByOrganizationId(
        supabase
          .from("payments")
          .select("amount, payment_method, paid_at")
          .eq("payment_status", "completed")
          .gte("paid_at", from.toISOString())
          .lt("paid_at", to.toISOString()),
        orgId,
        superAdmin
      );

      const byMethod: Record<string, { total: number; count: number }> = {};
      ((data || []) as Array<{ amount: number; payment_method: string | null }>).forEach((p) => {
        const method = formatPaymentMethodLabel(p.payment_method);
        if (!byMethod[method]) byMethod[method] = { total: 0, count: 0 };
        byMethod[method].total += Number(p.amount || 0);
        byMethod[method].count += 1;
      });

      setRows(
        Object.entries(byMethod)
          .map(([method, v]) => ({ method, total: v.total, count: v.count }))
          .sort((a, b) => b.total - a.total)
      );
    } catch (e) {
      console.error("Error loading payments by method:", e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    const csvRows = [
      ["Method", "Count", "Total"],
      ...rows.map((r) => [r.method, String(r.count), r.total.toFixed(2)]),
    ];
    const csv = csvRows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "financial_payments_by_method.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-bold text-slate-900">Payments by Method</h1>
          <PageNotes ariaLabel="Payments by method help">
            <p>Completed receipts grouped by payment method.</p>
          </PageNotes>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          className="border border-slate-300 rounded-lg px-4 py-2 text-sm hover:bg-slate-50"
        >
          Export CSV
        </button>
      </div>
      <div className="flex flex-wrap gap-4 mb-6">
        <select value={dateRange} onChange={(e) => setDateRange(e.target.value as DateRangeKey)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="this_week">This Week</option>
          <option value="this_month">This Month</option>
          <option value="this_quarter">This Quarter</option>
          <option value="this_year">This Year</option>
          <option value="last_week">Last Week</option>
          <option value="last_month">Last Month</option>
          <option value="last_quarter">Last Quarter</option>
          <option value="last_year">Last Year</option>
          <option value="custom">Custom</option>
        </select>
        {dateRange === "custom" && (
          <>
            <input type="date" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <input type="date" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </>
        )}
      </div>

      {loading ? (
        <p className="text-slate-500 py-4">Loading…</p>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left p-3">Method</th>
                <th className="text-right p-3">Count</th>
                <th className="text-right p-3">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.method} className="border-t">
                  <td className="p-3">{r.method}</td>
                  <td className="p-3 text-right">{r.count}</td>
                  <td className="p-3 text-right font-medium">{r.total.toFixed(2)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="p-6 text-center text-slate-500">No data for selected period.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
