import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { computeRangeInTimezone, type DateRangeKey } from "../../lib/timezone";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import { PageNotes } from "../common/PageNotes";

interface ChargeTypeRow {
  chargeType: string;
  total: number;
  count: number;
}

export function FinancialRevenueByChargeTypePage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const businessType = (user?.business_type || "").toLowerCase();

  const [dateRange, setDateRange] = useState<DateRangeKey>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ChargeTypeRow[]>([]);

  useEffect(() => {
    loadData();
  }, [dateRange, customFrom, customTo, orgId, superAdmin]);

  const loadData = async () => {
    setLoading(true);
    try {
      const { from, to } = computeRangeInTimezone(dateRange, customFrom, customTo);
      const fromStr = from.toISOString();
      const toStr = to.toISOString();

      const [billingRes, ordersRes, productsRes, retailMovesRes] = await Promise.all([
        filterByOrganizationId(
          supabase
            .from("billing")
            .select("id, amount, charge_type, charged_at")
            .gte("charged_at", fromStr)
            .lt("charged_at", toStr),
          orgId,
          superAdmin
        ),
        filterByOrganizationId(
          supabase
            .from("kitchen_orders")
            .select("id, created_at, kitchen_order_items(quantity, product_id)")
            .gte("created_at", fromStr)
            .lt("created_at", toStr),
          orgId,
          superAdmin
        ),
        filterByOrganizationId(supabase.from("products").select("id, sales_price"), orgId, superAdmin),
        filterByOrganizationId(
          supabase
            .from("product_stock_movements")
            .select("product_id, source_id, quantity_out, movement_date, source_type")
            .eq("source_type", "sale")
            .gt("quantity_out", 0)
            .gte("movement_date", fromStr)
            .lt("movement_date", toStr),
          orgId,
          superAdmin
        ),
      ]);

      const billings = (billingRes.data || []) as { id: string; amount: number; charge_type: string | null }[];
      const orders = (ordersRes.data || []) as any[];
      const retailMoves = (retailMovesRes.data || []) as Array<{ product_id: string; source_id: string | null; quantity_out: number | null }>;
      const productMap = Object.fromEntries(
        ((productsRes.data || []) as { id: string; sales_price: number | null }[]).map((p) => [p.id, p])
      );

      const byType: Record<string, { total: number; count: number }> = {};
      billings.forEach((b) => {
        const t = (b.charge_type || "other").charAt(0).toUpperCase() + (b.charge_type || "other").slice(1);
        if (!byType[t]) byType[t] = { total: 0, count: 0 };
        byType[t].total += Number(b.amount || 0);
        byType[t].count += 1;
      });

      let hotelPosTotal = 0;
      orders.forEach((o: any) => {
        (o.kitchen_order_items || []).forEach((item: any) => {
          const qty = Number(item.quantity || 0);
          const price = Number((item.product_id && productMap[item.product_id]?.sales_price) ?? 0);
          hotelPosTotal += qty * price;
        });
      });
      byType["Hotel POS"] = { total: hotelPosTotal, count: orders.length };

      const kitchenOrderIds = new Set(orders.map((o: any) => String(o.id)));
      let retailTotal = 0;
      let retailCount = 0;
      retailMoves.forEach((mv) => {
        const sourceId = String(mv.source_id || "");
        if (sourceId && kitchenOrderIds.has(sourceId)) return;
        const qty = Number(mv.quantity_out || 0);
        if (qty <= 0) return;
        const price = Number((mv.product_id && productMap[mv.product_id]?.sales_price) ?? 0);
        retailTotal += qty * price;
        retailCount += 1;
      });
      byType["Retail POS"] = { total: retailTotal, count: retailCount };

      let mapped = Object.entries(byType)
        .map(([chargeType, v]) => ({ chargeType, total: v.total, count: v.count }))
        .sort((a, b) => b.total - a.total);

      // Show only relevant charge types for the current business type.
      if (businessType === "retail" || businessType === "restaurant") {
        mapped = mapped.filter((r) => r.chargeType === "Retail POS");
      } else if (businessType === "hotel") {
        mapped = mapped.filter((r) => r.chargeType !== "Retail POS");
      }

      setRows(mapped);
    } catch (e) {
      console.error("Error loading revenue by charge type:", e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    const csvRows = [
      ["Charge Type", "Count", "Total"],
      ...rows.map((r) => [r.chargeType, String(r.count), r.total.toFixed(2)]),
    ];
    const csv = csvRows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "financial_revenue_by_charge_type.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-bold text-slate-900">Revenue by Charge Type</h1>
          <PageNotes ariaLabel="Revenue by charge type help">
            <p>Sales split by billing, hotel POS, and retail POS.</p>
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
                <th className="text-right p-3">Total</th>
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
