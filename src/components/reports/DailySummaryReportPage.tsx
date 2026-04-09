import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { businessDayRangeForDateString, businessTodayISO } from "../../lib/timezone";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import {
  buildInvoiceSettlementMap,
  invoiceBalanceDue,
  parseInvoiceAllocationsJson,
} from "../../lib/invoicePaymentAllocations";
import { isPosCashReceipt } from "../../lib/paymentClassification";
import { formatPaymentMethodLabel } from "../../lib/paymentMethod";
import { effectiveStockMovementInOut } from "../../lib/stockMovementEffective";
import type { Database } from "../../lib/database.types";
import { PageNotes } from "../common/PageNotes";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

type PaymentRow = Database["public"]["Tables"]["payments"]["Row"];

type InvoiceRow = {
  id: string;
  invoice_number: string;
  customer_name: string;
  issue_date: string;
  status: "draft" | "sent" | "paid" | "void";
  total: number;
};

type BillRow = {
  id: string;
  vendor_id: string | null;
  amount: number | null;
  status: string | null;
  bill_date: string | null;
  created_at: string | null;
  vendors?: { name?: string | null } | null;
};

type VendorPaymentRow = {
  id: string;
  vendor_id: string | null;
  amount: number | null;
  payment_date: string | null;
  created_at: string | null;
  vendors?: { name?: string | null } | null;
};

type StockMoveRow = {
  id: string;
  product_id: string;
  movement_date: string;
  quantity_in: number | null;
  quantity_out: number | null;
  source_type: string | null;
  source_id: string | null;
  location: string | null;
  note: string | null;
};

type ExpenseRow = {
  id: string;
  vendor_id: string | null;
  amount: number | null;
  description: string | null;
  expense_date: string | null;
  vendors?: { name?: string | null } | null;
};

function issueDateKey(issueDate: string): string {
  const s = String(issueDate || "").trim();
  if (s.length >= 10) return s.slice(0, 10);
  return s;
}

function formatMoney(n: number) {
  return Number.isFinite(n)
    ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0.00";
}

function mergeById<T extends { id: string }>(a: T[], b: T[]): T[] {
  const m = new Map<string, T>();
  [...a, ...b].forEach((x) => m.set(x.id, x));
  return [...m.values()];
}

function paymentInDay(p: PaymentRow, from: Date, to: Date): boolean {
  if (p.payment_status !== "completed") return false;
  const t = new Date(p.paid_at).getTime();
  return t >= from.getTime() && t < to.getTime();
}

function isNonPosIncomingPayment(p: PaymentRow): boolean {
  return !isPosCashReceipt(p);
}

function ModuleHeading({ label }: { label: string }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2 border-b border-slate-200 pb-1">{label}</p>
  );
}

export function DailySummaryReportPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [reportDate, setReportDate] = useState(businessTodayISO());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [invoicesIssued, setInvoicesIssued] = useState<InvoiceRow[]>([]);
  const [settlement, setSettlement] = useState<ReturnType<typeof buildInvoiceSettlementMap>>({});
  const [paymentsDay, setPaymentsDay] = useState<PaymentRow[]>([]);

  const [billsDay, setBillsDay] = useState<BillRow[]>([]);
  const [vendorPayDay, setVendorPayDay] = useState<VendorPaymentRow[]>([]);

  const [stockMoves, setStockMoves] = useState<StockMoveRow[]>([]);
  const [productNameById, setProductNameById] = useState<Record<string, string>>({});

  const [billingChargesTotal, setBillingChargesTotal] = useState(0);
  const [kitchenPosTotal, setKitchenPosTotal] = useState(0);
  const [retailPosTotal, setRetailPosTotal] = useState(0);

  const [expensesRows, setExpensesRows] = useState<ExpenseRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!orgId && !superAdmin) {
        setInvoicesIssued([]);
        setSettlement({});
        setPaymentsDay([]);
        setBillsDay([]);
        setVendorPayDay([]);
        setStockMoves([]);
        setExpensesRows([]);
        return;
      }
      const day = businessDayRangeForDateString(reportDate);
      if (!day) {
        setError("Invalid date.");
        return;
      }
      const fromStr = day.from.toISOString();
      const toStr = day.to.toISOString();

      const invQ = filterByOrganizationId(
        sb
          .from("retail_invoices")
          .select("id, invoice_number, customer_name, issue_date, status, total")
          .neq("status", "void")
          .order("invoice_number", { ascending: true }),
        orgId,
        superAdmin
      );
      const payAllQ = filterByOrganizationId(
        supabase.from("payments").select("*").eq("payment_status", "completed").order("paid_at", { ascending: true }),
        orgId,
        superAdmin
      );

      const billsByDateQ = filterByOrganizationId(
        supabase.from("bills").select("id, vendor_id, amount, status, bill_date, created_at, vendors(name)").eq("bill_date", reportDate),
        orgId,
        superAdmin
      );
      const billsCreatedQ = filterByOrganizationId(
        supabase
          .from("bills")
          .select("id, vendor_id, amount, status, bill_date, created_at, vendors(name)")
          .is("bill_date", null)
          .gte("created_at", fromStr)
          .lt("created_at", toStr),
        orgId,
        superAdmin
      );

      const vpDateQ = filterByOrganizationId(
        supabase.from("vendor_payments").select("id, vendor_id, amount, payment_date, created_at, vendors(name)").eq("payment_date", reportDate),
        orgId,
        superAdmin
      );
      const vpCreatedQ = filterByOrganizationId(
        supabase
          .from("vendor_payments")
          .select("id, vendor_id, amount, payment_date, created_at, vendors(name)")
          .is("payment_date", null)
          .gte("created_at", fromStr)
          .lt("created_at", toStr),
        orgId,
        superAdmin
      );

      const stockQ = filterByOrganizationId(
        supabase
          .from("product_stock_movements")
          .select("id, product_id, movement_date, quantity_in, quantity_out, source_type, source_id, location, note, unit_cost")
          .gte("movement_date", fromStr)
          .lt("movement_date", toStr)
          .order("movement_date", { ascending: true }),
        orgId,
        superAdmin
      );

      const productsQ = filterByOrganizationId(
        supabase.from("products").select("id, name, sales_price, cost_price"),
        orgId,
        superAdmin
      );

      const billingQ = filterByOrganizationId(
        supabase.from("billing").select("amount").gte("charged_at", fromStr).lt("charged_at", toStr),
        orgId,
        superAdmin
      );

      const kitchenQ = filterByOrganizationId(
        supabase
          .from("kitchen_orders")
          .select(
            `
          id,
          created_at,
          kitchen_order_items(quantity, product_id)
        `
          )
          .gte("created_at", fromStr)
          .lt("created_at", toStr),
        orgId,
        superAdmin
      );

      const expensesQ = filterByOrganizationId(
        supabase.from("expenses").select("id, vendor_id, amount, description, expense_date, vendors(name)").eq("expense_date", reportDate),
        orgId,
        superAdmin
      );

      const [
        invRes,
        payRes,
        billsA,
        billsB,
        vpA,
        vpB,
        stockRes,
        productsRes,
        billingRes,
        kitchenRes,
        expRes,
      ] = await Promise.all([
        invQ,
        payAllQ,
        billsByDateQ,
        billsCreatedQ,
        vpDateQ,
        vpCreatedQ,
        stockQ,
        productsQ,
        billingQ,
        kitchenQ,
        expensesQ,
      ]);

      if (invRes.error) throw invRes.error;
      if (payRes.error) throw payRes.error;

      if (billsA.error) console.warn("[Daily summary] bills:", billsA.error.message);
      if (billsB.error) console.warn("[Daily summary] bills (created):", billsB.error.message);
      if (vpA.error) console.warn("[Daily summary] vendor_payments:", vpA.error.message);
      if (vpB.error) console.warn("[Daily summary] vendor_payments (created):", vpB.error.message);
      if (stockRes.error) console.warn("[Daily summary] stock:", stockRes.error.message);
      if (productsRes.error) console.warn("[Daily summary] products:", productsRes.error);
      if (billingRes.error) console.warn("[Daily summary] billing:", billingRes.error.message);
      if (kitchenRes.error) console.warn("[Daily summary] kitchen_orders:", kitchenRes.error.message);
      if (expRes.error) console.warn("[Daily summary] expenses:", expRes.error.message);

      const allInv = (invRes.data || []) as InvoiceRow[];
      const dateKey = issueDateKey(reportDate);
      setInvoicesIssued(allInv.filter((r) => issueDateKey(r.issue_date) === dateKey));

      const allPayments = (payRes.data || []) as PaymentRow[];
      setSettlement(buildInvoiceSettlementMap(allPayments));
      setPaymentsDay(allPayments.filter((p) => paymentInDay(p, day.from, day.to)));

      setBillsDay(mergeById((billsA.data || []) as BillRow[], (billsB.data || []) as BillRow[]));
      setVendorPayDay(mergeById((vpA.data || []) as VendorPaymentRow[], (vpB.data || []) as VendorPaymentRow[]));

      const moves = (stockRes.data || []) as StockMoveRow[];
      setStockMoves(moves);

      const products = (productsRes.data || []) as Array<{
        id: string;
        name: string;
        sales_price: number | null;
        cost_price: number | null;
      }>;
      const pmap = Object.fromEntries(products.map((p) => [p.id, p])) as Record<
        string,
        { id: string; name: string; sales_price: number | null; cost_price: number | null }
      >;
      setProductNameById(Object.fromEntries(products.map((p) => [p.id, p.name])));

      const billRows = (billingRes.data || []) as { amount: number | null }[];
      setBillingChargesTotal(billRows.reduce((s, b) => s + Number(b.amount ?? 0), 0));

      const orders = (kitchenRes.data || []) as any[];
      let kTotal = 0;
      for (const o of orders) {
        const items = o.kitchen_order_items || [];
        for (const it of items) {
          const pr = it.product_id ? pmap[it.product_id] : null;
          const price = Number(pr?.sales_price ?? 0);
          const qty = Number(it.quantity ?? 0);
          kTotal += qty * price;
        }
      }
      setKitchenPosTotal(kTotal);

      let rPos = 0;
      for (const m of moves) {
        const st = String(m.source_type || "").toLowerCase();
        if (st !== "sale") continue;
        const { outQty } = effectiveStockMovementInOut(m);
        if (outQty <= 0) continue;
        const pr = pmap[m.product_id];
        const unit = Number(pr?.sales_price ?? 0);
        rPos += outQty * unit;
      }
      setRetailPosTotal(rPos);

      setExpensesRows((expRes.data || []) as ExpenseRow[]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load report.";
      setError(msg);
      setInvoicesIssued([]);
      setSettlement({});
      setPaymentsDay([]);
      setBillsDay([]);
      setVendorPayDay([]);
      setStockMoves([]);
      setExpensesRows([]);
    } finally {
      setLoading(false);
    }
  }, [orgId, superAdmin, reportDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const posReceipts = useMemo(() => paymentsDay.filter((p) => isPosCashReceipt(p)), [paymentsDay]);
  const debtorAndOther = useMemo(() => paymentsDay.filter((p) => isNonPosIncomingPayment(p)), [paymentsDay]);

  const invoiceTotals = useMemo(() => {
    let gross = 0;
    let paid = 0;
    let unpaid = 0;
    for (const inv of invoicesIssued) {
      const t = Number(inv.total ?? 0);
      gross += t;
      const p = settlement[inv.id]?.paid ?? 0;
      paid += p;
      unpaid += invoiceBalanceDue(inv, settlement);
    }
    return { gross, paid, unpaid, count: invoicesIssued.length };
  }, [invoicesIssued, settlement]);

  const posTotal = useMemo(() => posReceipts.reduce((s, p) => s + Number(p.amount ?? 0), 0), [posReceipts]);
  const debtorTotal = useMemo(
    () => debtorAndOther.reduce((s, p) => s + Number(p.amount ?? 0), 0),
    [debtorAndOther]
  );

  const purchaseTotals = useMemo(() => {
    const purchaseAmount = billsDay.reduce((s, b) => s + Number(b.amount ?? 0), 0);
    const paymentAmount = vendorPayDay.reduce((s, p) => s + Number(p.amount ?? 0), 0);
    return { purchaseAmount, paymentAmount, billCount: billsDay.length, payCount: vendorPayDay.length };
  }, [billsDay, vendorPayDay]);

  const stockAgg = useMemo(() => {
    let qtyIn = 0;
    let qtyOut = 0;
    const bySource: Record<string, { inQty: number; outQty: number }> = {};
    for (const m of stockMoves) {
      const { inQty, outQty } = effectiveStockMovementInOut(m);
      qtyIn += inQty;
      qtyOut += outQty;
      const key = String(m.source_type || "—");
      if (!bySource[key]) bySource[key] = { inQty: 0, outQty: 0 };
      bySource[key].inQty += inQty;
      bySource[key].outQty += outQty;
    }
    return { qtyIn, qtyOut, bySource, lineCount: stockMoves.length };
  }, [stockMoves]);

  const expensesTotal = useMemo(
    () => expensesRows.reduce((s, e) => s + Number(e.amount ?? 0), 0),
    [expensesRows]
  );

  const exportCsv = () => {
    const lines: string[] = [];
    const esc = (x: unknown) => `"${String(x ?? "").replace(/"/g, '""')}"`;
    lines.push(["Daily summary (all modules)", reportDate, "Uganda (EAT)"].map(esc).join(","));
    lines.push([]);
    lines.push(["— Sales —"].map(esc).join(","));
    lines.push(["Invoices issued (accrual)", "", "", ""].map(esc).join(","));
    lines.push(["Invoice #", "Customer", "Total", "Paid to date", "Unpaid balance"].map(esc).join(","));
    for (const inv of invoicesIssued) {
      const paid = settlement[inv.id]?.paid ?? 0;
      const bal = invoiceBalanceDue(inv, settlement);
      lines.push([inv.invoice_number, inv.customer_name, inv.total, paid, bal].map(esc).join(","));
    }
    lines.push(
      ["Subtotal invoices", invoiceTotals.count, invoiceTotals.gross, invoiceTotals.paid, invoiceTotals.unpaid].map(esc).join(",")
    );
    lines.push(["Hotel billing charges (day)", billingChargesTotal, "", ""].map(esc).join(","));
    lines.push(["Kitchen POS (est. retail price)", kitchenPosTotal, "", ""].map(esc).join(","));
    lines.push(["Retail POS (est. from sale movements)", retailPosTotal, "", ""].map(esc).join(","));
    lines.push([]);
    lines.push(["POS cash receipts", "", ""].map(esc).join(","));
    lines.push(["Paid at", "Amount", "Method", "Transaction"].map(esc).join(","));
    for (const p of posReceipts) {
      lines.push([p.paid_at, p.amount, formatPaymentMethodLabel(p.payment_method), p.transaction_id || ""].map(esc).join(","));
    }
    lines.push(["Subtotal POS", posTotal, "", ""].map(esc).join(","));
    lines.push([]);
    lines.push(["Debtor & other payments", "", "", ""].map(esc).join(","));
    for (const p of debtorAndOther) {
      const alloc = parseInvoiceAllocationsJson(p.invoice_allocations)
        .map((a) => `${a.invoice_id.slice(0, 8)}:${a.amount}`)
        .join("; ");
      lines.push([p.paid_at, p.amount, formatPaymentMethodLabel(p.payment_method), alloc || "—"].map(esc).join(","));
    }
    lines.push(["Subtotal debtor/other", debtorTotal, "", ""].map(esc).join(","));

    lines.push([]);
    lines.push(["— Purchases —"].map(esc).join(","));
    lines.push(["Bills", "Vendor", "Amount", "Status"].map(esc).join(","));
    for (const b of billsDay) {
      lines.push([b.id.slice(0, 8), b.vendors?.name || "", b.amount, b.status].map(esc).join(","));
    }
    lines.push(["Subtotal bills", purchaseTotals.billCount, purchaseTotals.purchaseAmount, ""].map(esc).join(","));
    lines.push(["Vendor payments", "", "", ""].map(esc).join(","));
    for (const p of vendorPayDay) {
      lines.push([p.id.slice(0, 8), p.vendors?.name || "", p.amount, p.payment_date || p.created_at].map(esc).join(","));
    }
    lines.push(["Subtotal vendor payments", purchaseTotals.payCount, purchaseTotals.paymentAmount, ""].map(esc).join(","));

    lines.push([]);
    lines.push(["— Inventory —"].map(esc).join(","));
    lines.push(["Source type", "Qty in", "Qty out"].map(esc).join(","));
    for (const [k, v] of Object.entries(stockAgg.bySource)) {
      lines.push([k, v.inQty, v.outQty].map(esc).join(","));
    }
    lines.push(["Total stock lines", stockAgg.lineCount, stockAgg.qtyIn, stockAgg.qtyOut].map(esc).join(","));
    lines.push(["Detail", "Product", "Location", "In", "Out", "Source"].map(esc).join(","));
    for (const m of stockMoves) {
      const { inQty, outQty } = effectiveStockMovementInOut(m);
      lines.push(
        [
          m.movement_date,
          productNameById[m.product_id] || m.product_id.slice(0, 8),
          m.location || "",
          inQty,
          outQty,
          m.source_type || "",
        ]
          .map(esc)
          .join(",")
      );
    }

    lines.push([]);
    lines.push(["— Expenses —"].map(esc).join(","));
    lines.push(["Description", "Vendor", "Amount"].map(esc).join(","));
    for (const e of expensesRows) {
      lines.push([e.description || "", e.vendors?.name || "", e.amount].map(esc).join(","));
    }
    lines.push(["Subtotal expenses", expensesRows.length, expensesTotal, ""].map(esc).join(","));

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `daily_summary_${reportDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 md:p-8 max-w-6xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold text-slate-900">Daily summary</h1>
            <PageNotes ariaLabel="Daily summary help">
              <p>
                One-day snapshot across modules (Uganda EAT): sales-related activity, purchases, inventory movements, and expenses. Amounts use
                different bases (issue date vs payment date vs movement time) — do not sum across sections as a single P&amp;L figure.
              </p>
            </PageNotes>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 text-sm font-medium"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Report date</label>
          <input
            type="date"
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            value={reportDate}
            onChange={(e) => setReportDate(e.target.value)}
          />
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={loading}
          className="flex items-center gap-2 bg-brand-700 text-white px-4 py-2 rounded-lg hover:bg-brand-800 disabled:opacity-50 text-sm font-medium"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-sm">{error}</div>
      )}

      {loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : (
        <>
          <section className="mb-10">
            <ModuleHeading label="Sales & revenue" />
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              <div className="bg-white p-3 rounded-lg border border-slate-200">
                <p className="text-xs text-slate-500">Invoices issued</p>
                <p className="text-xl font-bold text-slate-900">{invoiceTotals.count}</p>
              </div>
              <div className="bg-white p-3 rounded-lg border border-slate-200">
                <p className="text-xs text-slate-500">Invoiced (gross)</p>
                <p className="text-xl font-bold text-slate-900">{formatMoney(invoiceTotals.gross)}</p>
              </div>
              <div className="bg-white p-3 rounded-lg border border-slate-200">
                <p className="text-xs text-slate-500">Hotel billing (day)</p>
                <p className="text-xl font-bold text-slate-900">{formatMoney(billingChargesTotal)}</p>
              </div>
              <div className="bg-white p-3 rounded-lg border border-slate-200">
                <p className="text-xs text-slate-500">Kitchen POS (est.)</p>
                <p className="text-xl font-bold text-slate-900">{formatMoney(kitchenPosTotal)}</p>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
              <div className="bg-white p-3 rounded-lg border border-slate-200">
                <p className="text-xs text-slate-500">Retail POS (est. sales)</p>
                <p className="text-xl font-bold text-slate-900">{formatMoney(retailPosTotal)}</p>
              </div>
              <div className="bg-white p-3 rounded-lg border border-slate-200">
                <p className="text-xs text-slate-500">POS cash receipts</p>
                <p className="text-xl font-bold text-emerald-700">{formatMoney(posTotal)}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">{posReceipts.length} payment(s)</p>
              </div>
              <div className="bg-white p-3 rounded-lg border border-slate-200">
                <p className="text-xs text-slate-500">Debtor &amp; other</p>
                <p className="text-xl font-bold text-slate-900">{formatMoney(debtorTotal)}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">{debtorAndOther.length} payment(s)</p>
              </div>
              <div className="bg-white p-3 rounded-lg border border-slate-200">
                <p className="text-xs text-slate-500">Invoice unpaid balance</p>
                <p className="text-xl font-bold text-amber-800">{formatMoney(invoiceTotals.unpaid)}</p>
              </div>
            </div>

            <h3 className="text-sm font-semibold text-slate-800 mb-2">Retail invoices</h3>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left p-2">Invoice #</th>
                    <th className="text-left p-2">Customer</th>
                    <th className="text-right p-2">Total</th>
                    <th className="text-right p-2">Paid</th>
                    <th className="text-right p-2">Unpaid</th>
                  </tr>
                </thead>
                <tbody>
                  {invoicesIssued.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-slate-500">
                        No invoices this date.
                      </td>
                    </tr>
                  ) : (
                    invoicesIssued.map((inv) => {
                      const paid = settlement[inv.id]?.paid ?? 0;
                      const bal = invoiceBalanceDue(inv, settlement);
                      return (
                        <tr key={inv.id} className="border-t border-slate-100">
                          <td className="p-2 font-mono text-xs">{inv.invoice_number}</td>
                          <td className="p-2">{inv.customer_name}</td>
                          <td className="p-2 text-right">{formatMoney(Number(inv.total ?? 0))}</td>
                          <td className="p-2 text-right text-emerald-700">{formatMoney(paid)}</td>
                          <td className="p-2 text-right text-amber-800">{formatMoney(bal)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <h3 className="text-sm font-semibold text-slate-800 mb-2">POS cash receipts</h3>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left p-2">Paid at</th>
                    <th className="text-right p-2">Amount</th>
                    <th className="text-left p-2">Method</th>
                    <th className="text-left p-2">Transaction</th>
                  </tr>
                </thead>
                <tbody>
                  {posReceipts.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-4 text-center text-slate-500">
                        None this day.
                      </td>
                    </tr>
                  ) : (
                    posReceipts.map((p) => (
                      <tr key={p.id} className="border-t border-slate-100">
                        <td className="p-2 whitespace-nowrap text-xs">{new Date(p.paid_at).toLocaleString()}</td>
                        <td className="p-2 text-right">{formatMoney(Number(p.amount ?? 0))}</td>
                        <td className="p-2">{formatPaymentMethodLabel(p.payment_method)}</td>
                        <td className="p-2 font-mono text-xs">{p.transaction_id || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <h3 className="text-sm font-semibold text-slate-800 mb-2">Debtor &amp; other payments</h3>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left p-2">Paid at</th>
                    <th className="text-right p-2">Amount</th>
                    <th className="text-left p-2">Method</th>
                    <th className="text-left p-2">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {debtorAndOther.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-4 text-center text-slate-500">
                        None this day.
                      </td>
                    </tr>
                  ) : (
                    debtorAndOther.map((p) => {
                      const alloc = parseInvoiceAllocationsJson(p.invoice_allocations);
                      const allocLabel =
                        alloc.length > 0
                          ? alloc.map((a) => `${a.amount.toFixed(2)} → invoice`).join(", ")
                          : (p.transaction_id || "—");
                      return (
                        <tr key={p.id} className="border-t border-slate-100">
                          <td className="p-2 whitespace-nowrap text-xs">{new Date(p.paid_at).toLocaleString()}</td>
                          <td className="p-2 text-right">{formatMoney(Number(p.amount ?? 0))}</td>
                          <td className="p-2">{formatPaymentMethodLabel(p.payment_method)}</td>
                          <td className="p-2 text-slate-600 text-xs max-w-md">{allocLabel}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mb-10">
            <ModuleHeading label="Purchases" />
            <div className="grid sm:grid-cols-3 gap-3 mb-4">
              <div className="bg-white p-3 rounded-lg border border-slate-200">
                <p className="text-xs text-slate-500">Bills (day)</p>
                <p className="text-xl font-bold text-slate-900">{formatMoney(purchaseTotals.purchaseAmount)}</p>
                <p className="text-[10px] text-slate-400">{purchaseTotals.billCount} bill(s)</p>
              </div>
              <div className="bg-white p-3 rounded-lg border border-slate-200">
                <p className="text-xs text-slate-500">Vendor payments (day)</p>
                <p className="text-xl font-bold text-slate-900">{formatMoney(purchaseTotals.paymentAmount)}</p>
                <p className="text-[10px] text-slate-400">{purchaseTotals.payCount} payment(s)</p>
              </div>
              <div className="bg-white p-3 rounded-lg border border-slate-200">
                <p className="text-xs text-slate-500">Net (bills − payments)</p>
                <p className="text-xl font-bold text-slate-900">
                  {formatMoney(purchaseTotals.purchaseAmount - purchaseTotals.paymentAmount)}
                </p>
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <h3 className="text-sm font-medium text-slate-700 mb-2">Bills</h3>
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden max-h-56 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <th className="text-left p-2">Vendor</th>
                        <th className="text-right p-2">Amount</th>
                        <th className="text-left p-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {billsDay.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="p-4 text-center text-slate-500">
                            None.
                          </td>
                        </tr>
                      ) : (
                        billsDay.map((b) => (
                          <tr key={b.id} className="border-t border-slate-100">
                            <td className="p-2">{b.vendors?.name || "—"}</td>
                            <td className="p-2 text-right">{formatMoney(Number(b.amount ?? 0))}</td>
                            <td className="p-2 text-xs">{b.status || "—"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <h3 className="text-sm font-medium text-slate-700 mb-2">Vendor payments</h3>
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden max-h-56 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <th className="text-left p-2">Vendor</th>
                        <th className="text-right p-2">Amount</th>
                        <th className="text-left p-2">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vendorPayDay.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="p-4 text-center text-slate-500">
                            None.
                          </td>
                        </tr>
                      ) : (
                        vendorPayDay.map((p) => (
                          <tr key={p.id} className="border-t border-slate-100">
                            <td className="p-2">{p.vendors?.name || "—"}</td>
                            <td className="p-2 text-right">{formatMoney(Number(p.amount ?? 0))}</td>
                            <td className="p-2 text-xs">{p.payment_date || p.created_at?.slice(0, 10) || "—"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>

          <section className="mb-10">
            <ModuleHeading label="Inventory" />
            <div className="grid sm:grid-cols-3 gap-3 mb-4">
              <div className="bg-white p-3 rounded-lg border border-slate-200">
                <p className="text-xs text-slate-500">Movement lines</p>
                <p className="text-xl font-bold text-slate-900">{stockAgg.lineCount}</p>
              </div>
              <div className="bg-white p-3 rounded-lg border border-slate-200">
                <p className="text-xs text-slate-500">Qty in (effective)</p>
                <p className="text-xl font-bold text-emerald-700">{stockAgg.qtyIn.toFixed(2)}</p>
              </div>
              <div className="bg-white p-3 rounded-lg border border-slate-200">
                <p className="text-xs text-slate-500">Qty out (effective)</p>
                <p className="text-xl font-bold text-rose-700">{stockAgg.qtyOut.toFixed(2)}</p>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-4">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left p-2">Source type</th>
                    <th className="text-right p-2">Qty in</th>
                    <th className="text-right p-2">Qty out</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(stockAgg.bySource).length === 0 ? (
                    <tr>
                      <td colSpan={3} className="p-4 text-center text-slate-500">
                        No stock movements this day.
                      </td>
                    </tr>
                  ) : (
                    Object.entries(stockAgg.bySource)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([k, v]) => (
                        <tr key={k} className="border-t border-slate-100">
                          <td className="p-2 font-mono text-xs">{k || "—"}</td>
                          <td className="p-2 text-right">{v.inQty.toFixed(2)}</td>
                          <td className="p-2 text-right">{v.outQty.toFixed(2)}</td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
            <h3 className="text-sm font-medium text-slate-700 mb-2">Movement detail</h3>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden max-h-72 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="text-left p-2">Time</th>
                    <th className="text-left p-2">Product</th>
                    <th className="text-left p-2">Loc</th>
                    <th className="text-right p-2">In</th>
                    <th className="text-right p-2">Out</th>
                    <th className="text-left p-2">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {stockMoves.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-slate-500">
                        None.
                      </td>
                    </tr>
                  ) : (
                    stockMoves.map((m) => {
                      const { inQty, outQty } = effectiveStockMovementInOut(m);
                      return (
                        <tr key={m.id} className="border-t border-slate-100">
                          <td className="p-2 whitespace-nowrap text-xs">{new Date(m.movement_date).toLocaleString()}</td>
                          <td className="p-2 text-xs">{productNameById[m.product_id] || m.product_id.slice(0, 8)}</td>
                          <td className="p-2 text-xs">{m.location || "—"}</td>
                          <td className="p-2 text-right">{inQty > 0 ? inQty.toFixed(2) : "—"}</td>
                          <td className="p-2 text-right">{outQty > 0 ? outQty.toFixed(2) : "—"}</td>
                          <td className="p-2 font-mono text-xs">{m.source_type || "—"}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <ModuleHeading label="Expenses" />
            <div className="grid sm:grid-cols-2 gap-3 mb-4">
              <div className="bg-white p-3 rounded-lg border border-slate-200">
                <p className="text-xs text-slate-500">Total (expense date)</p>
                <p className="text-xl font-bold text-slate-900">{formatMoney(expensesTotal)}</p>
                <p className="text-[10px] text-slate-400">{expensesRows.length} record(s)</p>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left p-2">Description</th>
                    <th className="text-left p-2">Vendor</th>
                    <th className="text-right p-2">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {expensesRows.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="p-4 text-center text-slate-500">
                        No expenses this date.
                      </td>
                    </tr>
                  ) : (
                    expensesRows.map((e) => (
                      <tr key={e.id} className="border-t border-slate-100">
                        <td className="p-2">{e.description || "—"}</td>
                        <td className="p-2">{e.vendors?.name || "—"}</td>
                        <td className="p-2 text-right">{formatMoney(Number(e.amount ?? 0))}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
