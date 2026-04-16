import { useEffect, useState } from "react";
import { DollarSign, TrendingUp, CreditCard, Banknote } from "lucide-react";
import { supabase } from "../lib/supabase";
import { computeRangeInTimezone, type DateRangeKey } from "../lib/timezone";
import { useAuth } from "../contexts/AuthContext";
import { filterByOrganizationId } from "../lib/supabaseOrgFilter";
import { formatPaymentMethodLabel } from "../lib/paymentMethod";
import { PageNotes } from "./common/PageNotes";

interface ChargeTypeRow {
  chargeType: string;
  total: number;
  count: number;
}

interface PaymentMethodRow {
  method: string;
  total: number;
  count: number;
}

export function FinancialReportsPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [dateRange, setDateRange] = useState<DateRangeKey>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [totalCharges, setTotalCharges] = useState(0);
  const [totalPayments, setTotalPayments] = useState(0);
  const [chargeTypeRows, setChargeTypeRows] = useState<ChargeTypeRow[]>([]);
  const [paymentMethodRows, setPaymentMethodRows] = useState<PaymentMethodRow[]>([]);

  useEffect(() => {
    fetchFinancialReport();
  }, [dateRange, customFrom, customTo, orgId, superAdmin]);

  const fetchFinancialReport = async () => {
    setLoading(true);
    try {
      if (!orgId && !superAdmin) {
        setTotalCharges(0);
        setTotalPayments(0);
        setChargeTypeRows([]);
        setPaymentMethodRows([]);
        return;
      }
      const { from, to } = computeRangeInTimezone(dateRange, customFrom, customTo);
      const fromStr = from.toISOString();
      const toStr = to.toISOString();

      const [billingRes, paymentsRes, ordersRes, productsRes, retailMovesRes] = await Promise.all([
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
            .from("payments")
            .select("id, amount, payment_method, paid_at")
            .eq("payment_status", "completed")
            .gte("paid_at", fromStr)
            .lt("paid_at", toStr),
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

      const billings = (billingRes.data || []) as { amount: number; charge_type: string }[];
      const payments = (paymentsRes.data || []) as { amount: number; payment_method: string }[];
      const orders = (ordersRes.data || []) as any[];
      const retailMoves = (retailMovesRes.data || []) as Array<{
        product_id: string;
        source_id: string | null;
        quantity_out: number | null;
      }>;
      const productMap = Object.fromEntries(
        ((productsRes?.data || []) as { id: string; sales_price: number | null }[])
          .map((p) => [p.id, p])
      );

      const billingTotal = billings.reduce((s, b) => s + Number(b.amount), 0);
      let ordersTotal = 0;
      orders.forEach((o: any) => {
        (o.kitchen_order_items || []).forEach((item: any) => {
          const price = Number((item.product_id && productMap[item.product_id]?.sales_price) ?? 0);
          const qty = Number(item.quantity ?? 0);
          ordersTotal += price * qty;
        });
      });
      const kitchenOrderIdSet = new Set<string>(orders.map((o: any) => String(o.id)));
      let retailSalesTotal = 0;
      retailMoves.forEach((mv) => {
        const sourceId = String(mv.source_id || "");
        // Exclude hotel POS sale movements already represented by kitchen_orders.
        if (sourceId && kitchenOrderIdSet.has(sourceId)) return;
        const qty = Number(mv.quantity_out ?? 0);
        if (qty <= 0) return;
        const unitPrice = Number((mv.product_id && productMap[mv.product_id]?.sales_price) ?? 0);
        retailSalesTotal += qty * unitPrice;
      });

      const chargesTotal = billingTotal + ordersTotal + retailSalesTotal;
      const paymentsTotal = payments.reduce((s, p) => s + Number(p.amount), 0);

      setTotalCharges(chargesTotal);
      setTotalPayments(paymentsTotal);

      const chargeByType: Record<string, { total: number; count: number }> = {};
      billings.forEach((b) => {
        const type = (b.charge_type || "other").charAt(0).toUpperCase() + (b.charge_type || "other").slice(1);
        if (!chargeByType[type]) chargeByType[type] = { total: 0, count: 0 };
        chargeByType[type].total += Number(b.amount);
        chargeByType[type].count += 1;
      });
      chargeByType["Hotel POS"] = { total: ordersTotal, count: orders.length };
      const retailSalesCount = retailMoves.filter((mv) => {
        const sourceId = String(mv.source_id || "");
        return !(sourceId && kitchenOrderIdSet.has(sourceId)) && Number(mv.quantity_out ?? 0) > 0;
      }).length;
      chargeByType["Retail POS"] = { total: retailSalesTotal, count: retailSalesCount };
      setChargeTypeRows(
        Object.entries(chargeByType).map(([chargeType, v]) => ({
          chargeType,
          total: v.total,
          count: v.count,
        }))
      );

      const payByMethod: Record<string, { total: number; count: number }> = {};
      payments.forEach((p) => {
        const method = formatPaymentMethodLabel(p.payment_method);
        if (!payByMethod[method]) payByMethod[method] = { total: 0, count: 0 };
        payByMethod[method].total += Number(p.amount);
        payByMethod[method].count += 1;
      });
      setPaymentMethodRows(
        Object.entries(payByMethod).map(([method, v]) => ({
          method,
          total: v.total,
          count: v.count,
        }))
      );
    } catch (e) {
      console.error("Error fetching financial report:", e);
      setTotalCharges(0);
      setTotalPayments(0);
      setChargeTypeRows([]);
      setPaymentMethodRows([]);
    } finally {
      setLoading(false);
    }
  };

  const outstanding = totalCharges - totalPayments;

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-bold text-slate-900">Financial Reports</h1>
          <PageNotes ariaLabel="Financial reports help">
            <p>Revenue, charges, payments, and breakdowns by charge type and payment method.</p>
          </PageNotes>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 mb-6">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-700">Period</span>
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value as DateRangeKey)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          >
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
        </div>
        {dateRange === "custom" && (
          <div className="flex gap-2 items-center">
            <input
              type="date"
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
            <span className="text-slate-500 text-sm">to</span>
            <input
              type="date"
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-slate-500 py-4">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-white rounded-xl p-6 border border-slate-200">
              <div className="flex items-center gap-3 mb-2">
                <div className="bg-emerald-100 p-3 rounded-lg">
                  <DollarSign className="w-6 h-6 text-emerald-600" />
                </div>
                <p className="text-slate-500 text-sm font-medium">Total Sales/Charges</p>
              </div>
              <p className="text-2xl font-bold text-slate-900">{totalCharges.toFixed(2)}</p>
              <p className="text-xs text-slate-500 mt-1">Billing + Hotel POS + Retail POS in period</p>
            </div>
            <div className="bg-white rounded-xl p-6 border border-slate-200">
              <div className="flex items-center gap-3 mb-2">
                <div className="bg-blue-100 p-3 rounded-lg">
                  <TrendingUp className="w-6 h-6 text-blue-600" />
                </div>
                <p className="text-slate-500 text-sm font-medium">Payments Received</p>
              </div>
              <p className="text-2xl font-bold text-slate-900">{totalPayments.toFixed(2)}</p>
              <p className="text-xs text-slate-500 mt-1">Completed payments in period</p>
            </div>
            <div className="bg-white rounded-xl p-6 border border-slate-200">
              <div className="flex items-center gap-3 mb-2">
                <div className="bg-amber-100 p-3 rounded-lg">
                  <CreditCard className="w-6 h-6 text-amber-600" />
                </div>
                <p className="text-slate-500 text-sm font-medium">Outstanding</p>
              </div>
              <p className="text-2xl font-bold text-slate-900">${outstanding.toFixed(2)}</p>
              <p className="text-xs text-slate-500 mt-1">Charges minus payments</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <h2 className="text-lg font-bold text-slate-900 p-4 border-b">Revenue by Charge Type</h2>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left p-3">Type</th>
                      <th className="text-right p-3">Count</th>
                      <th className="text-right p-3">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chargeTypeRows.map((r) => (
                      <tr key={r.chargeType} className="border-t">
                        <td className="p-3">{r.chargeType}</td>
                        <td className="p-3 text-right">{r.count}</td>
                        <td className="p-3 text-right font-medium">{r.total.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <h2 className="text-lg font-bold text-slate-900 p-4 border-b">Payments by Method</h2>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left p-3">Method</th>
                      <th className="text-right p-3">Count</th>
                      <th className="text-right p-3">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paymentMethodRows.map((r) => (
                      <tr key={r.method} className="border-t">
                        <td className="p-3">{r.method}</td>
                        <td className="p-3 text-right">{r.count}</td>
                        <td className="p-3 text-right font-medium">{r.total.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                const rows = [
                  ["Financial Report"],
                  ["Total Sales/Charges", totalCharges.toFixed(2)],
                  ["Total Payments", totalPayments.toFixed(2)],
                  ["Outstanding", outstanding.toFixed(2)],
                  [],
                  ["Revenue by Charge Type", "Count", "Total"],
                  ...chargeTypeRows.map((r) => [r.chargeType, r.count, r.total.toFixed(2)]),
                  [],
                  ["Payments by Method", "Count", "Total"],
                  ...paymentMethodRows.map((r) => [r.method, r.count, r.total.toFixed(2)]),
                ];
                const csv = rows.map((r) => r.join(",")).join("\n");
                const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = "financial_report.csv";
                a.click();
                URL.revokeObjectURL(a.href);
              }}
              className="border border-slate-300 rounded-lg px-4 py-2 text-sm hover:bg-slate-50 flex items-center gap-2"
            >
              <Banknote className="w-4 h-4" />
              Export CSV
            </button>
          </div>
        </>
      )}
    </div>
  );
}
