import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { computeRangeInTimezone, type DateRangeKey } from "../../lib/timezone";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import { PageNotes } from "../common/PageNotes";

interface VendorSummaryRow {
  vendor: string;
  billsCount: number;
  purchaseAmount: number;
  paymentAmount: number;
  balance: number;
}

interface PurchaseLineDetail {
  source: "purchase_order" | "bill";
  dateLabel: string;
  vendor: string;
  description: string;
  quantity: number;
  rate: number;
  unit: string;
  amount: number;
}

export function DailyPurchasesSummaryPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [dateRange, setDateRange] = useState<DateRangeKey>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [loading, setLoading] = useState(true);

  const [totalBills, setTotalBills] = useState(0);
  const [approvedBills, setApprovedBills] = useState(0);
  const [purchaseAmount, setPurchaseAmount] = useState(0);
  const [paymentsMade, setPaymentsMade] = useState(0);
  const [outstanding, setOutstanding] = useState(0);
  const [rows, setRows] = useState<VendorSummaryRow[]>([]);
  const [lineDetails, setLineDetails] = useState<PurchaseLineDetail[]>([]);

  useEffect(() => {
    loadData();
  }, [dateRange, customFrom, customTo, orgId, superAdmin]);

  const loadData = async () => {
    setLoading(true);
    try {
      const { from, to } = computeRangeInTimezone(dateRange, customFrom, customTo);
      const fromStr = from.toISOString();
      const toStr = to.toISOString();

      const [billsRes, paymentsRes, poRes] = await Promise.all([
        filterByOrganizationId(
          supabase
            .from("bills")
            .select("id, vendor_id, amount, status, bill_date, created_at, description, purchase_order_id, vendors(name)")
            .gte("created_at", fromStr)
            .lt("created_at", toStr),
          orgId,
          superAdmin
        ),
        filterByOrganizationId(
          supabase
            .from("vendor_payments")
            .select("id, vendor_id, amount, payment_date, created_at, vendors(name)")
            .gte("created_at", fromStr)
            .lt("created_at", toStr),
          orgId,
          superAdmin
        ),
        filterByOrganizationId(
          supabase
            .from("purchase_orders")
            .select("id, order_date, created_at, vendor_id, vendors(name), purchase_order_items(description, quantity, cost_price)")
            .gte("created_at", fromStr)
            .lt("created_at", toStr),
          orgId,
          superAdmin
        ),
      ]);

      const bills = (billsRes.data || []) as Array<{
        id: string;
        vendor_id: string | null;
        amount: number | null;
        status: string | null;
        bill_date: string | null;
        created_at: string | null;
        description: string | null;
        purchase_order_id?: string | null;
        vendors?: { name?: string | null } | null;
      }>;
      const payments = (paymentsRes.data || []) as Array<{
        id: string;
        vendor_id: string | null;
        amount: number | null;
        payment_date: string | null;
        created_at: string | null;
        vendors?: { name?: string | null } | null;
      }>;

      const inRange = (d: string | null | undefined): boolean => {
        if (!d) return false;
        const dt = new Date(d);
        return dt >= from && dt < to;
      };

      // Prefer business dates where available, fallback to created_at.
      const billsInRange = bills.filter((b) => inRange(b.bill_date) || (!b.bill_date && inRange(b.created_at)));
      const paymentsInRange = payments.filter((p) => inRange(p.payment_date) || (!p.payment_date && inRange(p.created_at)));

      const billTotal = billsInRange.reduce((s, b) => s + Number(b.amount || 0), 0);
      const paymentTotal = paymentsInRange.reduce((s, p) => s + Number(p.amount || 0), 0);
      const approvedCount = billsInRange.filter((b) => String(b.status || "").toLowerCase() === "approved").length;

      const byVendor: Record<string, VendorSummaryRow> = {};
      billsInRange.forEach((b) => {
        const key = b.vendor_id || "unknown";
        if (!byVendor[key]) {
          byVendor[key] = {
            vendor: b.vendors?.name || "Unknown vendor",
            billsCount: 0,
            purchaseAmount: 0,
            paymentAmount: 0,
            balance: 0,
          };
        }
        byVendor[key].billsCount += 1;
        byVendor[key].purchaseAmount += Number(b.amount || 0);
      });
      paymentsInRange.forEach((p) => {
        const key = p.vendor_id || "unknown";
        if (!byVendor[key]) {
          byVendor[key] = {
            vendor: p.vendors?.name || "Unknown vendor",
            billsCount: 0,
            purchaseAmount: 0,
            paymentAmount: 0,
            balance: 0,
          };
        }
        byVendor[key].paymentAmount += Number(p.amount || 0);
      });

      const vendorRows = Object.values(byVendor)
        .map((r) => ({ ...r, balance: r.purchaseAmount - r.paymentAmount }))
        .sort((a, b) => b.purchaseAmount - a.purchaseAmount);

      const purchaseOrders = (poRes.data || []) as Array<{
        id: string;
        order_date: string | null;
        created_at: string | null;
        vendor_id: string | null;
        vendors?: { name?: string | null } | null;
        purchase_order_items?: Array<{ description: string; quantity: number | null; cost_price: number | null }> | null;
      }>;

      const details: PurchaseLineDetail[] = [];

      for (const po of purchaseOrders) {
        const inPoRange = inRange(po.order_date) || (!po.order_date && inRange(po.created_at));
        if (!inPoRange) continue;
        const vendor = po.vendors?.name || "Unknown vendor";
        const dateLabel = po.order_date || (po.created_at ? po.created_at.slice(0, 10) : "—");
        for (const it of po.purchase_order_items || []) {
          const qty = Number(it.quantity ?? 0);
          const rate = Number(it.cost_price ?? 0);
          details.push({
            source: "purchase_order",
            dateLabel,
            vendor,
            description: (it.description || "").trim() || "—",
            quantity: qty,
            rate,
            unit: "ea",
            amount: qty * rate,
          });
        }
      }

      for (const b of billsInRange) {
        if (b.purchase_order_id) continue;
        const amt = Number(b.amount || 0);
        details.push({
          source: "bill",
          dateLabel: b.bill_date || (b.created_at ? b.created_at.slice(0, 10) : "—"),
          vendor: b.vendors?.name || "Unknown vendor",
          description: (b.description || "").trim() || "Bill / GRN",
          quantity: 1,
          rate: amt,
          unit: "ea",
          amount: amt,
        });
      }

      details.sort((a, b) => String(b.dateLabel).localeCompare(String(a.dateLabel)));
      setLineDetails(details);

      setTotalBills(billsInRange.length);
      setApprovedBills(approvedCount);
      setPurchaseAmount(billTotal);
      setPaymentsMade(paymentTotal);
      setOutstanding(billTotal - paymentTotal);
      setRows(vendorRows);
    } catch (e) {
      console.error("Error loading daily purchases summary:", e);
      setTotalBills(0);
      setApprovedBills(0);
      setPurchaseAmount(0);
      setPaymentsMade(0);
      setOutstanding(0);
      setRows([]);
      setLineDetails([]);
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    const csvRows = [
      ["Metric", "Value"],
      ["Total Bills", String(totalBills)],
      ["Approved Bills", String(approvedBills)],
      ["Total Purchases", purchaseAmount.toFixed(2)],
      ["Payments Made", paymentsMade.toFixed(2)],
      ["Outstanding", outstanding.toFixed(2)],
      [],
      ["Vendor", "Bills Count", "Purchases", "Payments", "Balance"],
      ...rows.map((r) => [r.vendor, String(r.billsCount), r.purchaseAmount.toFixed(2), r.paymentAmount.toFixed(2), r.balance.toFixed(2)]),
      [],
      ["Date", "Vendor", "Description", "Quantity", "Rate", "Unit", "Amount"],
      ...lineDetails.map((d) => [
        d.dateLabel,
        d.vendor.replaceAll(",", " "),
        d.description.replaceAll(",", " "),
        String(d.quantity),
        d.rate.toFixed(4),
        d.unit,
        d.amount.toFixed(2),
      ]),
    ];
    const csv = csvRows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "daily_purchases_summary.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold text-slate-900">Daily Purchases Summary</h1>
            <PageNotes ariaLabel="Daily purchases summary help">
              <p>Purchases, payments made, and outstanding balances.</p>
            </PageNotes>
          </div>
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
        <>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Total Bills</p>
              <p className="text-xl font-bold text-slate-900">{totalBills}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Approved Bills</p>
              <p className="text-xl font-bold text-slate-900">{approvedBills}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Total Purchases</p>
              <p className="text-xl font-bold text-slate-900">{purchaseAmount.toFixed(2)}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Payments Made</p>
              <p className="text-xl font-bold text-slate-900">{paymentsMade.toFixed(2)}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Outstanding</p>
              <p className="text-xl font-bold text-slate-900">{outstanding.toFixed(2)}</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left p-3">Vendor</th>
                  <th className="text-right p-3">Bills</th>
                  <th className="text-right p-3">Purchases</th>
                  <th className="text-right p-3">Payments</th>
                  <th className="text-right p-3">Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.vendor} className="border-t">
                    <td className="p-3">{r.vendor}</td>
                    <td className="p-3 text-right">{r.billsCount}</td>
                    <td className="p-3 text-right">{r.purchaseAmount.toFixed(2)}</td>
                    <td className="p-3 text-right">{r.paymentAmount.toFixed(2)}</td>
                    <td className="p-3 text-right font-medium">{r.balance.toFixed(2)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-slate-500">No data for selected period.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <h2 className="text-lg font-semibold text-slate-900 mt-8 mb-3">Line detail</h2>
          <p className="text-sm text-slate-600 mb-3">
            Purchase order lines and standalone bills (GRNs without a linked PO are shown once). Columns: description, quantity, rate, unit, amount.
          </p>
          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left p-3">Date</th>
                  <th className="text-left p-3">Vendor</th>
                  <th className="text-left p-3">Description</th>
                  <th className="text-right p-3">Quantity</th>
                  <th className="text-right p-3">Rate</th>
                  <th className="text-left p-3">Unit</th>
                  <th className="text-right p-3">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lineDetails.map((d, i) => (
                  <tr key={`${d.source}-${i}-${d.dateLabel}-${d.description}`} className="border-t">
                    <td className="p-3 whitespace-nowrap">{d.dateLabel}</td>
                    <td className="p-3">{d.vendor}</td>
                    <td className="p-3">{d.description}</td>
                    <td className="p-3 text-right tabular-nums">{d.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                    <td className="p-3 text-right tabular-nums">{d.rate.toFixed(4)}</td>
                    <td className="p-3">{d.unit}</td>
                    <td className="p-3 text-right font-medium tabular-nums">{d.amount.toFixed(2)}</td>
                  </tr>
                ))}
                {lineDetails.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-slate-500">
                      No purchase lines in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
