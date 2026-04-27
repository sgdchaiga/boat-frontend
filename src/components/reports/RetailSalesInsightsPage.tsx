import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { normalizePaymentMethod, formatPaymentMethodLabel, type PaymentMethodCode } from "../../lib/paymentMethod";
import { toast } from "../ui/use-toast";
import { useAuth } from "../../contexts/AuthContext";

type SalesDateFilter = "today" | "custom";

interface RetailSalePaymentRow {
  paymentId: string;
  saleId: string;
  paidAt: string;
  amount: number;
  paymentMethod: PaymentMethodCode;
  paymentStatus: "pending" | "completed" | "failed" | "refunded";
  processedBy: string | null;
  cashierName: string | null;
}
interface TopProductRow {
  name: string;
  qty: number;
  amount: number;
}

interface OpenCreditSaleRow {
  id: string;
  customer_id: string | null;
  sale_at: string;
  credit_due_date: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  amount_due: number;
  total_amount: number;
  payment_status: "pending" | "partial" | "completed" | "overpaid" | "refunded";
}
interface CreditReminderRow {
  id: string;
  channel: "whatsapp" | "manual_copy";
  message: string;
  reminded_at: string;
  reminded_by: string | null;
}

export function RetailSalesInsightsPage() {
  const { user } = useAuth();
  const [salesDateFilter, setSalesDateFilter] = useState<SalesDateFilter>("today");
  const [salesFromDate, setSalesFromDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [salesToDate, setSalesToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [sales, setSales] = useState<RetailSalePaymentRow[]>([]);
  const [openCreditSales, setOpenCreditSales] = useState<OpenCreditSaleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [showOverdueOnly, setShowOverdueOnly] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodCode>("cash");
  const [settleAmountDraftBySaleId, setSettleAmountDraftBySaleId] = useState<Record<string, string>>({});
  const [settlingSaleId, setSettlingSaleId] = useState<string | null>(null);
  const [refundReasonByPaymentId, setRefundReasonByPaymentId] = useState<Record<string, string>>({});
  const [refundingPaymentId, setRefundingPaymentId] = useState<string | null>(null);
  const [expandedReminderSaleId, setExpandedReminderSaleId] = useState<string | null>(null);
  const [reminderHistoryBySaleId, setReminderHistoryBySaleId] = useState<Record<string, CreditReminderRow[]>>({});
  const [loadingReminderSaleId, setLoadingReminderSaleId] = useState<string | null>(null);
  const [salesSearch, setSalesSearch] = useState("");
  const [previousSales, setPreviousSales] = useState<RetailSalePaymentRow[]>([]);
  const [topProducts, setTopProducts] = useState<TopProductRow[]>([]);

  const loadData = async () => {
    setLoading(true);
    try {
      let start: Date;
      let end: Date;
      if (salesDateFilter === "today") {
        start = new Date();
        start.setHours(0, 0, 0, 0);
        end = new Date(start);
        end.setDate(end.getDate() + 1);
      } else {
        start = new Date(`${salesFromDate}T00:00:00`);
        end = new Date(`${salesToDate}T00:00:00`);
        end.setDate(end.getDate() + 1);
      }
      const msPerDay = 24 * 60 * 60 * 1000;
      const daySpan = Math.max(1, Math.round((end.getTime() - start.getTime()) / msPerDay));
      const previousStart = new Date(start.getTime() - daySpan * msPerDay);
      const previousEnd = new Date(end.getTime() - daySpan * msPerDay);

      const [{ data: payRows }, { data: creditRows }, { data: previousPayRows }, { data: lineRows }] = await Promise.all([
        supabase
          .from("payments")
          .select("id, transaction_id, paid_at, amount, payment_method, payment_status, stay_id, processed_by")
          .is("stay_id", null)
          .not("transaction_id", "is", null)
          .gte("paid_at", start.toISOString())
          .lt("paid_at", end.toISOString())
          .order("paid_at", { ascending: false }),
        supabase
          .from("retail_sales")
          .select("id,customer_id,sale_at,credit_due_date,customer_name,customer_phone,amount_due,total_amount,payment_status")
          .gt("amount_due", 0)
          .in("payment_status", ["pending", "partial"])
          .order("sale_at", { ascending: false })
          .limit(100),
        supabase
          .from("payments")
          .select("id, transaction_id, paid_at, amount, payment_method, payment_status, stay_id, processed_by")
          .is("stay_id", null)
          .not("transaction_id", "is", null)
          .gte("paid_at", previousStart.toISOString())
          .lt("paid_at", previousEnd.toISOString())
          .order("paid_at", { ascending: false }),
        supabase
          .from("retail_sale_lines")
          .select("description,quantity,line_total,retail_sales!inner(sale_at)")
          .gte("retail_sales.sale_at", start.toISOString())
          .lt("retail_sales.sale_at", end.toISOString()),
      ]);

      const rawPayments = (
        (payRows || []) as Array<{
          id: string;
          transaction_id: string | null;
          paid_at: string;
          amount: number | null;
          payment_method: string | null;
          payment_status: RetailSalePaymentRow["paymentStatus"];
          processed_by: string | null;
        }>
      );
      const cashierIds = [...new Set(rawPayments.map((p) => p.processed_by).filter(Boolean))] as string[];
      let cashierNameById = new Map<string, string>();
      if (cashierIds.length > 0) {
        const { data: staffRows } = await supabase.from("staff").select("id,full_name").in("id", cashierIds);
        cashierNameById = new Map(((staffRows || []) as Array<{ id: string; full_name: string }>).map((s) => [s.id, s.full_name]));
      }
      const mappedPayments = rawPayments.map((p) => ({
        paymentId: p.id,
        saleId: String(p.transaction_id || ""),
        paidAt: p.paid_at,
        amount: Number(p.amount ?? 0),
        paymentMethod: normalizePaymentMethod(p.payment_method as string),
        paymentStatus: p.payment_status,
        processedBy: p.processed_by ?? null,
        cashierName: p.processed_by ? cashierNameById.get(p.processed_by) ?? null : null,
      }));

      const previousRawPayments = (
        (previousPayRows || []) as Array<{
          id: string;
          transaction_id: string | null;
          paid_at: string;
          amount: number | null;
          payment_method: string | null;
          payment_status: RetailSalePaymentRow["paymentStatus"];
          processed_by: string | null;
        }>
      ).map((p) => ({
        paymentId: p.id,
        saleId: String(p.transaction_id || ""),
        paidAt: p.paid_at,
        amount: Number(p.amount ?? 0),
        paymentMethod: normalizePaymentMethod(p.payment_method as string),
        paymentStatus: p.payment_status,
        processedBy: p.processed_by ?? null,
        cashierName: p.processed_by ? cashierNameById.get(p.processed_by) ?? null : null,
      }));

      const byProduct = new Map<string, TopProductRow>();
      (
        (lineRows || []) as Array<{
          description: string | null;
          quantity: number | null;
          line_total: number | null;
        }>
      ).forEach((row) => {
        const name = (row.description || "Unnamed item").trim() || "Unnamed item";
        const current = byProduct.get(name) || { name, qty: 0, amount: 0 };
        current.qty += Number(row.quantity || 0);
        current.amount += Number(row.line_total || 0);
        byProduct.set(name, current);
      });
      const top = Array.from(byProduct.values())
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 8);

      setSales(mappedPayments);
      setOpenCreditSales((creditRows || []) as OpenCreditSaleRow[]);
      setPreviousSales(previousRawPayments);
      setTopProducts(top);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [salesDateFilter, salesFromDate, salesToDate]);

  const visibleCreditSales = useMemo(() => {
    if (!showOverdueOnly) return openCreditSales;
    const now = Date.now();
    return openCreditSales.filter((sale) => sale.credit_due_date && new Date(`${sale.credit_due_date}T00:00:00`).getTime() < now);
  }, [openCreditSales, showOverdueOnly]);

  const filteredSales = useMemo(() => {
    const q = salesSearch.trim().toLowerCase();
    if (!q) return sales;
    return sales.filter((row) => {
      const text = [
        row.saleId,
        formatPaymentMethodLabel(row.paymentMethod),
        row.paymentStatus,
        new Date(row.paidAt).toLocaleString(),
      ]
        .join(" ")
        .toLowerCase();
      return text.includes(q);
    });
  }, [sales, salesSearch]);

  const summary = useMemo(() => {
    const completed = sales.filter((s) => s.paymentStatus === "completed");
    const refunded = sales.filter((s) => s.paymentStatus === "refunded");
    const totalSalesValue = completed.reduce((sum, s) => sum + s.amount, 0);
    const refundedValue = refunded.reduce((sum, s) => sum + s.amount, 0);
    const outstandingCredit = openCreditSales.reduce((sum, s) => sum + Number(s.amount_due || 0), 0);
    const overdueCredit = openCreditSales
      .filter((s) => s.credit_due_date && new Date(`${s.credit_due_date}T00:00:00`).getTime() < Date.now())
      .reduce((sum, s) => sum + Number(s.amount_due || 0), 0);
    return {
      totalSalesValue,
      refundedValue,
      completedCount: completed.length,
      outstandingCredit,
      overdueCredit,
    };
  }, [sales, openCreditSales]);

  const previousSummary = useMemo(() => {
    const completed = previousSales.filter((s) => s.paymentStatus === "completed");
    const refunded = previousSales.filter((s) => s.paymentStatus === "refunded");
    return {
      totalSalesValue: completed.reduce((sum, s) => sum + s.amount, 0),
      refundedValue: refunded.reduce((sum, s) => sum + s.amount, 0),
      completedCount: completed.length,
    };
  }, [previousSales]);

  const formatDelta = (current: number, previous: number) => {
    const diff = current - previous;
    const pct = Math.abs(previous) > 0.0001 ? (diff / previous) * 100 : null;
    return {
      diff,
      label: pct == null ? `${diff >= 0 ? "+" : ""}${diff.toFixed(2)}` : `${diff >= 0 ? "+" : ""}${pct.toFixed(1)}%`,
      tone: diff > 0 ? "text-emerald-700" : diff < 0 ? "text-red-700" : "text-slate-500",
    };
  };

  const paymentMethodBreakdown = useMemo(() => {
    const buckets = new Map<PaymentMethodCode, { count: number; amount: number }>();
    for (const row of sales) {
      if (row.paymentStatus !== "completed") continue;
      const current = buckets.get(row.paymentMethod) || { count: 0, amount: 0 };
      current.count += 1;
      current.amount += row.amount;
      buckets.set(row.paymentMethod, current);
    }
    return Array.from(buckets.entries())
      .map(([method, v]) => ({ method, count: v.count, amount: v.amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [sales]);

  const topMethodAmount = paymentMethodBreakdown[0]?.amount ?? 0;

  const cashierLeaderboard = useMemo(() => {
    const byCashier = new Map<string, { cashierName: string; count: number; amount: number }>();
    for (const row of sales) {
      if (row.paymentStatus !== "completed") continue;
      const key = row.processedBy || "unknown";
      const name = row.cashierName || (row.processedBy ? `Staff ${row.processedBy.slice(0, 8)}` : "Unassigned");
      const curr = byCashier.get(key) || { cashierName: name, count: 0, amount: 0 };
      curr.count += 1;
      curr.amount += row.amount;
      byCashier.set(key, curr);
    }
    return Array.from(byCashier.values()).sort((a, b) => b.amount - a.amount).slice(0, 8);
  }, [sales]);

  const exportAnalyticsCsv = () => {
    const rangeLabel = salesDateFilter === "today" ? "today" : `${salesFromDate} to ${salesToDate}`;
    const rows: string[][] = [
      ["POS Analytics Snapshot"],
      ["Range", rangeLabel],
      [],
      ["KPI", "Value"],
      ["Completed sales", String(summary.completedCount)],
      ["Sales value", summary.totalSalesValue.toFixed(2)],
      ["Refunded value", summary.refundedValue.toFixed(2)],
      ["Open credit", summary.outstandingCredit.toFixed(2)],
      ["Overdue credit", summary.overdueCredit.toFixed(2)],
      [],
      ["Payment method", "Count", "Amount"],
      ...paymentMethodBreakdown.map((m) => [formatPaymentMethodLabel(m.method), String(m.count), m.amount.toFixed(2)]),
      [],
      ["Cashier", "Completed sales", "Amount"],
      ...cashierLeaderboard.map((c) => [c.cashierName, String(c.count), c.amount.toFixed(2)]),
      [],
      ["Payment ID", "Sale ID", "Paid at", "Method", "Status", "Amount", "Cashier"],
      ...filteredSales.map((s) => [
        s.paymentId,
        s.saleId,
        new Date(s.paidAt).toISOString(),
        formatPaymentMethodLabel(s.paymentMethod),
        s.paymentStatus,
        s.amount.toFixed(2),
        s.cashierName || "",
      ]),
    ];
    const csv = rows
      .map((r) => r.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pos-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const receiveBalancePayment = async (sale: OpenCreditSaleRow) => {
    const amount = Number(settleAmountDraftBySaleId[sale.id] || "");
    if (!Number.isFinite(amount) || amount <= 0) return toast({ title: "Invalid amount" });
    if (amount > sale.amount_due) return toast({ title: "Amount too high", description: "Cannot exceed amount due." });
    setSettlingSaleId(sale.id);
    try {
      const { data: saleRow, error: saleErr } = await supabase
        .from("retail_sales")
        .select("amount_paid,amount_due,customer_id")
        .eq("id", sale.id)
        .single();
      if (saleErr) throw saleErr;
      const nextPaid = Math.round((Number(saleRow.amount_paid ?? 0) + amount) * 100) / 100;
      const nextDue = Math.max(0, Math.round((Number(saleRow.amount_due ?? 0) - amount) * 100) / 100);
      const nextStatus = nextDue <= 0 ? "completed" : "partial";
      await supabase.from("retail_sale_payments").insert({
        sale_id: sale.id,
        payment_method: paymentMethod,
        amount,
        payment_status: "completed",
      });
      await supabase.from("payments").insert({
        organization_id: user?.organization_id ?? null,
        retail_customer_id: saleRow.customer_id ?? null,
        payment_source: "pos_retail",
        amount,
        payment_status: "completed",
        transaction_id: sale.id,
        processed_by: user?.id ?? null,
      });
      await supabase
        .from("retail_sales")
        .update({ amount_paid: nextPaid, amount_due: nextDue, payment_status: nextStatus, sale_type: nextDue <= 0 ? "cash" : "mixed" })
        .eq("id", sale.id);
      setSettleAmountDraftBySaleId((prev) => ({ ...prev, [sale.id]: "" }));
      setOpenCreditSales((prev) => prev.map((s) => (s.id === sale.id ? { ...s, amount_due: nextDue, payment_status: nextStatus } : s)).filter((s) => s.amount_due > 0));
      toast({ title: "Balance received", description: `Outstanding is now ${nextDue.toFixed(2)}.` });
    } catch (error: unknown) {
      toast({ title: "Settlement failed", description: error instanceof Error ? error.message : "Try again." });
    } finally {
      setSettlingSaleId(null);
    }
  };

  const sendCreditReminder = async (sale: OpenCreditSaleRow) => {
    const customerName = sale.customer_name || "Customer";
    const message = `Hello ${customerName}, this is a payment reminder. Your outstanding retail balance is ${sale.amount_due.toFixed(2)} for sale ${sale.id.slice(0, 8)}.${sale.credit_due_date ? ` Due date: ${sale.credit_due_date}.` : ""} Please settle at your earliest convenience.`;
    const phoneDigits = (sale.customer_phone || "").replace(/\D/g, "");
    const channel: "whatsapp" | "manual_copy" = phoneDigits ? "whatsapp" : "manual_copy";
    await supabase.from("retail_credit_reminders").insert({
      organization_id: user?.organization_id ?? null,
      sale_id: sale.id,
      customer_id: sale.customer_id,
      customer_name: sale.customer_name,
      customer_phone: sale.customer_phone,
      amount_due: sale.amount_due,
      due_date: sale.credit_due_date,
      channel,
      message,
      reminded_by: user?.id ?? null,
    });
    if (phoneDigits) {
      window.open(`https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
      toast({ title: "Reminder opened" });
    } else {
      await navigator.clipboard.writeText(message);
      toast({ title: "Reminder copied", description: "No phone on file, copied to clipboard." });
    }
    setReminderHistoryBySaleId((prev) => ({
      ...prev,
      [sale.id]: [{ id: `${Date.now()}`, channel, message, reminded_at: new Date().toISOString(), reminded_by: user?.id ?? null }, ...(prev[sale.id] || [])].slice(0, 5),
    }));
  };

  const toggleReminderHistory = async (saleId: string) => {
    if (expandedReminderSaleId === saleId) return setExpandedReminderSaleId(null);
    setExpandedReminderSaleId(saleId);
    if (reminderHistoryBySaleId[saleId]) return;
    setLoadingReminderSaleId(saleId);
    try {
      const { data } = await supabase
        .from("retail_credit_reminders")
        .select("id,channel,message,reminded_at,reminded_by")
        .eq("sale_id", saleId)
        .order("reminded_at", { ascending: false })
        .limit(5);
      setReminderHistoryBySaleId((prev) => ({ ...prev, [saleId]: ((data || []) as CreditReminderRow[]) }));
    } finally {
      setLoadingReminderSaleId(null);
    }
  };

  const reprintSale = async (saleId: string) => {
    const { data: lines } = await supabase
      .from("retail_sale_lines")
      .select("description,quantity,unit_price,line_total")
      .eq("sale_id", saleId)
      .order("line_no");
    const win = window.open("", "_blank", "width=380,height=700");
    if (!win) return toast({ title: "Popup blocked", description: "Enable popups to print." });
    const rows = (lines || []) as Array<{ description: string; quantity: number; unit_price: number; line_total: number }>;
    const total = rows.reduce((sum, r) => sum + Number(r.line_total || 0), 0);
    win.document.write(`<html><body style="font-family:monospace;padding:12px"><h3>Retail Receipt</h3><p>Sale ${saleId.slice(0,8)}</p>${rows.map((r)=>`<div>${r.quantity}x ${r.description} @ ${Number(r.unit_price).toFixed(2)} = ${Number(r.line_total).toFixed(2)}</div>`).join("")}<hr/><b>Total: ${total.toFixed(2)}</b></body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  const markRefunded = async (row: RetailSalePaymentRow) => {
    const reason = (refundReasonByPaymentId[row.paymentId] || "").trim();
    if (!reason) return toast({ title: "Refund reason required" });
    setRefundingPaymentId(row.paymentId);
    try {
      const newRef = `${row.saleId} [REFUND_REASON:${reason}]`;
      await supabase.from("payments").update({ payment_status: "refunded", transaction_id: newRef }).eq("id", row.paymentId);
      await supabase.from("retail_sales").update({ payment_status: "refunded", sale_status: "refunded" }).eq("id", row.saleId);
      setSales((prev) => prev.map((p) => (p.paymentId === row.paymentId ? { ...p, paymentStatus: "refunded" } : p)));
      toast({ title: "Marked refunded" });
    } catch (error: unknown) {
      toast({ title: "Refund failed", description: error instanceof Error ? error.message : "Try again." });
    } finally {
      setRefundingPaymentId(null);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">POS Analytics</h1>
          <p className="text-sm text-slate-600">Retail POS performance, collections, refunds, and credit operations.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={exportAnalyticsCsv} className="px-3 py-2 text-sm border rounded-lg">
            Export CSV
          </button>
          <button type="button" onClick={() => void loadData()} className="px-3 py-2 text-sm border rounded-lg" disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Completed sales</p>
          <p className="text-xl font-bold text-slate-900">{summary.completedCount}</p>
          <p className={`text-xs ${formatDelta(summary.completedCount, previousSummary.completedCount).tone}`}>
            vs prev: {formatDelta(summary.completedCount, previousSummary.completedCount).label}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Sales value</p>
          <p className="text-xl font-bold text-slate-900">{summary.totalSalesValue.toFixed(2)}</p>
          <p className={`text-xs ${formatDelta(summary.totalSalesValue, previousSummary.totalSalesValue).tone}`}>
            vs prev: {formatDelta(summary.totalSalesValue, previousSummary.totalSalesValue).label}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Refunded value</p>
          <p className="text-xl font-bold text-amber-700">{summary.refundedValue.toFixed(2)}</p>
          <p className={`text-xs ${formatDelta(summary.refundedValue, previousSummary.refundedValue).tone}`}>
            vs prev: {formatDelta(summary.refundedValue, previousSummary.refundedValue).label}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Open credit</p>
          <p className="text-xl font-bold text-slate-900">{summary.outstandingCredit.toFixed(2)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Overdue credit</p>
          <p className="text-xl font-bold text-red-700">{summary.overdueCredit.toFixed(2)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="text-base font-semibold text-slate-900 mb-3">Payment Method Mix</h2>
          <div className="space-y-2">
            {paymentMethodBreakdown.map((row) => {
              const pct = topMethodAmount > 0 ? (row.amount / topMethodAmount) * 100 : 0;
              return (
                <div key={row.method}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-700">{formatPaymentMethodLabel(row.method)}</span>
                    <span className="text-slate-900 font-medium">{row.amount.toFixed(2)} ({row.count})</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full bg-slate-900 rounded-full" style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                </div>
              );
            })}
            {paymentMethodBreakdown.length === 0 ? <p className="text-sm text-slate-500">No completed payments in selected range.</p> : null}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="text-base font-semibold text-slate-900 mb-3">Cashier Leaderboard</h2>
          <div className="space-y-2">
            {cashierLeaderboard.map((row, idx) => (
              <div key={`${row.cashierName}-${idx}`} className="flex items-center justify-between border border-slate-100 rounded-lg px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-slate-900">{row.cashierName}</p>
                  <p className="text-xs text-slate-500">{row.count} completed sales</p>
                </div>
                <p className="text-sm font-semibold text-slate-900">{row.amount.toFixed(2)}</p>
              </div>
            ))}
            {cashierLeaderboard.length === 0 ? <p className="text-sm text-slate-500">No completed sales for leaderboard.</p> : null}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h2 className="text-base font-semibold text-slate-900 mb-3">Top Products (by Sales Value)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-2 text-left">Product</th>
                <th className="py-2 pr-2 text-right">Qty</th>
                <th className="py-2 text-right">Sales value</th>
              </tr>
            </thead>
            <tbody>
              {topProducts.map((row) => (
                <tr key={row.name} className="border-b last:border-0">
                  <td className="py-2 pr-2">{row.name}</td>
                  <td className="py-2 pr-2 text-right">{row.qty.toFixed(2)}</td>
                  <td className="py-2 text-right font-medium">{row.amount.toFixed(2)}</td>
                </tr>
              ))}
              {topProducts.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-3 text-slate-500">No product sales in selected range.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap gap-2 items-center mb-3">
          <button className={`px-3 py-1.5 text-sm rounded ${salesDateFilter === "today" ? "bg-slate-900 text-white" : "bg-slate-100"}`} onClick={() => setSalesDateFilter("today")}>Today</button>
          <button className={`px-3 py-1.5 text-sm rounded ${salesDateFilter === "custom" ? "bg-slate-900 text-white" : "bg-slate-100"}`} onClick={() => setSalesDateFilter("custom")}>Custom</button>
          {salesDateFilter === "custom" ? (
            <>
              <input type="date" value={salesFromDate} onChange={(e) => setSalesFromDate(e.target.value)} className="border rounded px-2 py-1.5 text-sm" />
              <input type="date" value={salesToDate} onChange={(e) => setSalesToDate(e.target.value)} className="border rounded px-2 py-1.5 text-sm" />
            </>
          ) : null}
          <input
            type="text"
            value={salesSearch}
            onChange={(e) => setSalesSearch(e.target.value)}
            placeholder="Search sale, method, status..."
            className="border rounded px-2 py-1.5 text-sm min-w-[220px]"
          />
        </div>
        <h2 className="text-lg font-semibold text-slate-900 mb-2">POS Sales Activity</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-2">Time</th>
                <th className="py-2 pr-2">Sale</th>
                <th className="py-2 pr-2">Method</th>
                <th className="py-2 pr-2">Status</th>
                <th className="py-2 pr-2">Refund reason</th>
                <th className="py-2 text-right">Amount</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredSales.map((s) => (
                <tr key={s.paymentId} className="border-b last:border-0">
                  <td className="py-2 pr-2">{new Date(s.paidAt).toLocaleString()}</td>
                  <td className="py-2 pr-2 font-mono text-xs">{s.saleId.slice(0, 8)}</td>
                  <td className="py-2 pr-2">{formatPaymentMethodLabel(s.paymentMethod)}</td>
                  <td className="py-2 pr-2 capitalize">{s.paymentStatus}</td>
                  <td className="py-2 pr-2">
                    <input
                      type="text"
                      value={refundReasonByPaymentId[s.paymentId] || ""}
                      onChange={(e) => setRefundReasonByPaymentId((prev) => ({ ...prev, [s.paymentId]: e.target.value }))}
                      className="border rounded px-2 py-1 text-xs w-full"
                      placeholder="Reason"
                      disabled={s.paymentStatus === "refunded"}
                    />
                  </td>
                  <td className="py-2 text-right">{s.amount.toFixed(2)}</td>
                  <td className="py-2 text-right">
                    <div className="inline-flex gap-2">
                      <button type="button" onClick={() => void reprintSale(s.saleId)} className="px-2 py-1 border rounded text-xs">Reprint</button>
                      <button
                        type="button"
                        onClick={() => void markRefunded(s)}
                        disabled={s.paymentStatus === "refunded" || refundingPaymentId === s.paymentId}
                        className="px-2 py-1 border rounded text-xs text-amber-700 border-amber-300 disabled:opacity-50"
                      >
                        {s.paymentStatus === "refunded" ? "Refunded" : "Refund"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredSales.length === 0 ? (
                <tr><td className="py-3 text-slate-500" colSpan={7}>No sales for selected range.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-slate-900">Open Credit Balances</h2>
          <div className="flex items-center gap-2">
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethodCode)} className="border rounded px-2 py-1.5 text-xs">
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="mtn_mobile_money">MTN MoMo</option>
              <option value="airtel_money">Airtel Money</option>
            </select>
            <label className="inline-flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={showOverdueOnly} onChange={(e) => setShowOverdueOnly(e.target.checked)} />
              Overdue only
            </label>
          </div>
        </div>
        <div className="space-y-2">
          {visibleCreditSales.map((sale) => (
            <div key={sale.id} className="border rounded-lg p-3 flex flex-wrap items-center gap-2">
              <div className="min-w-[220px] flex-1">
                <p className="text-sm font-medium text-slate-900">{sale.customer_name || "Walk-in customer"}</p>
                <p className="text-xs text-slate-500">
                  Sale {sale.id.slice(0, 8)} · Due {sale.amount_due.toFixed(2)} / Total {sale.total_amount.toFixed(2)}
                </p>
                <p className={`text-xs ${sale.credit_due_date && new Date(`${sale.credit_due_date}T00:00:00`).getTime() < Date.now() ? "text-red-600" : "text-slate-500"}`}>
                  Due date: {sale.credit_due_date || "Not set"}
                </p>
              </div>
              <input
                type="number"
                step="0.01"
                min="0"
                value={settleAmountDraftBySaleId[sale.id] ?? ""}
                onChange={(e) => setSettleAmountDraftBySaleId((prev) => ({ ...prev, [sale.id]: e.target.value }))}
                placeholder="Amount"
                className="w-28 border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
              />
              <button
                type="button"
                onClick={() => void receiveBalancePayment(sale)}
                disabled={settlingSaleId === sale.id}
                className="px-3 py-1.5 text-sm border border-emerald-300 text-emerald-700 rounded-lg hover:bg-emerald-50 disabled:opacity-50"
              >
                {settlingSaleId === sale.id ? "Processing..." : "Receive Payment"}
              </button>
              <button type="button" onClick={() => void sendCreditReminder(sale)} className="px-3 py-1.5 text-sm border border-indigo-300 text-indigo-700 rounded-lg hover:bg-indigo-50">
                Send Reminder
              </button>
              <button type="button" onClick={() => void toggleReminderHistory(sale.id)} className="px-3 py-1.5 text-sm border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50">
                {expandedReminderSaleId === sale.id ? "Hide History" : "Reminder History"}
              </button>
              {expandedReminderSaleId === sale.id ? (
                <div className="w-full mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                  {loadingReminderSaleId === sale.id ? (
                    <p className="text-xs text-slate-500">Loading reminder history...</p>
                  ) : (reminderHistoryBySaleId[sale.id] || []).length === 0 ? (
                    <p className="text-xs text-slate-500">No reminders logged for this sale.</p>
                  ) : (
                    <div className="space-y-1">
                      {(reminderHistoryBySaleId[sale.id] || []).map((item) => (
                        <div key={item.id} className="text-xs text-slate-700 border border-slate-200 bg-white rounded px-2 py-1">
                          <p>{new Date(item.reminded_at).toLocaleString()} · {item.channel}</p>
                          <p className="text-slate-500 truncate">{item.message}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          ))}
          {visibleCreditSales.length === 0 ? <p className="text-sm text-slate-500">No open credit balances.</p> : null}
        </div>
      </div>
    </div>
  );
}
