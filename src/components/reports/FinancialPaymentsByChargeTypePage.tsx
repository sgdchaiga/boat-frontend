import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { computeRangeInTimezone, type DateRangeKey } from "../../lib/timezone";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import { PageNotes } from "../common/PageNotes";

interface PaymentByChargeTypeRow {
  chargeType: string;
  total: number;
  count: number;
}

export function FinancialPaymentsByChargeTypePage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [dateRange, setDateRange] = useState<DateRangeKey>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PaymentByChargeTypeRow[]>([]);

  useEffect(() => {
    loadData();
  }, [dateRange, customFrom, customTo, orgId, superAdmin]);

  const loadData = async () => {
    setLoading(true);
    try {
      const { from, to } = computeRangeInTimezone(dateRange, customFrom, customTo);
      const fromStr = from.toISOString();
      const toStr = to.toISOString();

      const { data: paymentsData } = await filterByOrganizationId(
        supabase
          .from("payments")
          .select("id, amount, transaction_id, stay_id, paid_at")
          .eq("payment_status", "completed")
          .gte("paid_at", fromStr)
          .lt("paid_at", toStr),
        orgId,
        superAdmin
      );

      const payments = (paymentsData || []) as Array<{
        id: string;
        amount: number | null;
        transaction_id: string | null;
        stay_id: string | null;
      }>;

      const txIds = Array.from(
        new Set(
          payments
            .map((p) => p.transaction_id)
            .filter((v): v is string => !!v)
        )
      );

      let billingById = new Map<string, string>();
      let kitchenOrderIds = new Set<string>();
      let retailSaleSourceIds = new Set<string>();

      if (txIds.length > 0) {
        const [billingTxRes, kitchenTxRes, retailTxRes] = await Promise.all([
          filterByOrganizationId(
            supabase.from("billing").select("id, charge_type").in("id", txIds),
            orgId,
            superAdmin
          ),
          filterByOrganizationId(
            supabase.from("kitchen_orders").select("id").in("id", txIds),
            orgId,
            superAdmin
          ),
          filterByOrganizationId(
            supabase
              .from("product_stock_movements")
              .select("source_id")
              .eq("source_type", "sale")
              .in("source_id", txIds),
            orgId,
            superAdmin
          ),
        ]);

        billingById = new Map(
          ((billingTxRes.data || []) as Array<{ id: string; charge_type: string | null }>).map((b) => [
            String(b.id),
            (b.charge_type || "other").charAt(0).toUpperCase() + (b.charge_type || "other").slice(1),
          ])
        );
        kitchenOrderIds = new Set(
          ((kitchenTxRes.data || []) as Array<{ id: string }>).map((x) => String(x.id))
        );
        retailSaleSourceIds = new Set(
          ((retailTxRes.data || []) as Array<{ source_id: string | null }>)
            .map((x) => String(x.source_id || ""))
            .filter(Boolean)
        );
      }

      const grouped: Record<string, { total: number; count: number }> = {};
      payments.forEach((p) => {
        const amount = Number(p.amount || 0);
        let key = "Unclassified";
        const tx = p.transaction_id ? String(p.transaction_id) : "";

        if (tx && billingById.has(tx)) {
          key = `Billing - ${billingById.get(tx)}`;
        } else if (tx && kitchenOrderIds.has(tx)) {
          key = "Hotel POS";
        } else if (tx && retailSaleSourceIds.has(tx)) {
          key = "Retail POS";
        } else if (p.stay_id) {
          key = "Billing";
        }

        if (!grouped[key]) grouped[key] = { total: 0, count: 0 };
        grouped[key].total += amount;
        grouped[key].count += 1;
      });

      setRows(
        Object.entries(grouped)
          .map(([chargeType, v]) => ({ chargeType, total: v.total, count: v.count }))
          .sort((a, b) => b.total - a.total)
      );
    } catch (e) {
      console.error("Error loading payments by charge type:", e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    const csvRows = [
      ["Charge Type", "Count", "Total Paid"],
      ...rows.map((r) => [r.chargeType, String(r.count), r.total.toFixed(2)]),
    ];
    const csv = csvRows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "financial_payments_by_charge_type.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-bold text-slate-900">Payments by Charge Type</h1>
          <PageNotes ariaLabel="Payments by charge type help">
            <p>Completed payments grouped by billing/POS source category.</p>
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
                <th className="text-left p-3">Charge Type</th>
                <th className="text-right p-3">Count</th>
                <th className="text-right p-3">Total Paid</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.chargeType} className="border-t">
                  <td className="p-3">{r.chargeType}</td>
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
