import { useEffect, useMemo, useState } from "react";
import { Clock } from "lucide-react";
import { supabase } from "../lib/supabase";
import { computeRangeInTimezone, type DateRangeKey } from "../lib/timezone";
import { useAuth } from "../contexts/AuthContext";
import { filterByOrganizationId } from "../lib/supabaseOrgFilter";
import {
  type PaymentMethodCode,
  PAYMENT_METHOD_SELECT_OPTIONS,
  formatPaymentMethodLabel,
  insertPaymentWithMethodCompat,
} from "../lib/paymentMethod";
import { PageNotes } from "./common/PageNotes";

type SaleLine = {
  id: string;
  line_no: number | null;
  description: string | null;
  product_id: string | null;
  quantity: number | null;
  unit_price: number | null;
  line_total: number | null;
  department_id: string | null;
};

type RetailSaleOrder = {
  id: string;
  sale_at: string;
  customer_name: string | null;
  retail_sale_lines: SaleLine[];
  payments_total?: number;
  payment_methods?: PaymentMethodCode[];
};

type ProductOption = {
  id: string;
  name: string;
  department_id: string | null;
  sales_price: number | null;
};

export function RetailPosOrdersPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [orders, setOrders] = useState<RetailSaleOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRangeKey>("last_30_days");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [departmentTab, setDepartmentTab] = useState<string>("all");
  const [departmentOptions, setDepartmentOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [payingOrder, setPayingOrder] = useState<RetailSaleOrder | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<PaymentMethodCode>("cash");
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [savingPayment, setSavingPayment] = useState(false);
  const [reversingOrderId, setReversingOrderId] = useState<string | null>(null);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [editingOrderDate, setEditingOrderDate] = useState("");
  const [editingOrderLines, setEditingOrderLines] = useState<
    Array<{ product_id: string; description: string; quantity: number; unit_price: number; department_id: string }>
  >([]);
  const role = (user?.role || "").toLowerCase();
  const [canEditPosOrdersByRole, setCanEditPosOrdersByRole] = useState<boolean>(!!user?.isSuperAdmin);
  const canReverse = canEditPosOrdersByRole;

  useEffect(() => {
    const loadRolePermission = async () => {
      if (superAdmin) {
        setCanEditPosOrdersByRole(true);
        return;
      }
      if (!orgId || !role) {
        setCanEditPosOrdersByRole(false);
        return;
      }
      const { data, error } = await supabase
        .from("staff_permission_overrides")
        .select("allowed")
        .eq("organization_id", orgId)
        .eq("staff_id", user?.id ?? "")
        .eq("permission_key", "pos_orders_edit")
        .maybeSingle();
      if (error && user?.id) {
        console.error("Retail POS permission lookup failed:", error);
        setCanEditPosOrdersByRole(false);
        return;
      }
      if (typeof data?.allowed === "boolean") {
        setCanEditPosOrdersByRole(!!data.allowed);
        return;
      }
      const rolePerm = await supabase
        .from("organization_permissions")
        .select("allowed")
        .eq("organization_id", orgId)
        .eq("role_key", role)
        .eq("permission_key", "pos_orders_edit")
        .maybeSingle();
      if (rolePerm.error) {
        console.error("Retail POS role permission lookup failed:", rolePerm.error);
        setCanEditPosOrdersByRole(false);
        return;
      }
      setCanEditPosOrdersByRole(!!rolePerm.data?.allowed);
    };
    void loadRolePermission();
  }, [orgId, role, superAdmin, user?.id]);

  useEffect(() => {
    void fetchOrders();
  }, [dateRange, customFrom, customTo, orgId, superAdmin]);

  const fetchOrders = async () => {
    try {
      setLoading(true);
      const { from, to } = computeRangeInTimezone(dateRange, customFrom, customTo);
      const [salesRes, departmentsRes, productsRes] = await Promise.all([
        filterByOrganizationId(
          supabase
            .from("retail_sales")
            .select("id,sale_at,customer_name")
            .gte("sale_at", from.toISOString())
            .lt("sale_at", to.toISOString())
            .order("sale_at", { ascending: false }),
          orgId,
          superAdmin
        ),
        filterByOrganizationId(supabase.from("departments").select("id,name").order("name"), orgId, superAdmin),
        filterByOrganizationId(
          supabase.from("products").select("id,name,department_id,sales_price").order("name"),
          orgId,
          superAdmin
        ),
      ]);

      const sales = (salesRes.data || []) as Array<{ id: string; sale_at: string; customer_name: string | null }>;
      const saleIds = sales.map((s) => s.id);
      const linesRes = saleIds.length
        ? await supabase
            .from("retail_sale_lines")
            .select("id,sale_id,line_no,description,product_id,quantity,unit_price,line_total,department_id")
            .in("sale_id", saleIds)
        : { data: [] };
      const saleLines = (linesRes.data || []) as Array<SaleLine & { sale_id: string }>;
      const linesBySaleId = new Map<string, SaleLine[]>();
      for (const line of saleLines) {
        const arr = linesBySaleId.get(line.sale_id) || [];
        arr.push(line);
        linesBySaleId.set(line.sale_id, arr);
      }
      const salesWithLines: RetailSaleOrder[] = sales.map((s) => ({
        ...s,
        retail_sale_lines: linesBySaleId.get(s.id) || [],
      }));
      const orderIds = salesWithLines.map((s) => s.id);
      let paymentsMap: Record<string, number> = {};
      let paymentMethodsMap: Record<string, PaymentMethodCode[]> = {};
      if (orderIds.length > 0) {
        const { data: paymentsData } = await filterByOrganizationId(
          supabase.from("payments").select("amount,payment_status,transaction_id,payment_method").in("transaction_id", orderIds),
          orgId,
          superAdmin
        );
        (paymentsData || []).forEach((p: any) => {
          if (p.payment_status === "completed" && p.transaction_id) {
            const key = p.transaction_id as string;
            paymentsMap[key] = (paymentsMap[key] || 0) + Number(p.amount || 0);
            const method = (p.payment_method || "cash") as PaymentMethodCode;
            const existing = paymentMethodsMap[key] || [];
            if (!existing.includes(method)) {
              paymentMethodsMap[key] = [...existing, method];
            }
          }
        });
      }
      setOrders(
        salesWithLines.map((s) => ({
          ...s,
          payments_total: paymentsMap[s.id] || 0,
          payment_methods: paymentMethodsMap[s.id] || [],
        }))
      );
      setDepartmentOptions((departmentsRes.data || []) as Array<{ id: string; name: string }>);
      setProductOptions((productsRes.data || []) as ProductOption[]);
    } finally {
      setLoading(false);
    }
  };

  const getTotals = (order: RetailSaleOrder, deptId?: string) => {
    const lines = deptId
      ? (order.retail_sale_lines || []).filter((l) => l.department_id === deptId)
      : order.retail_sale_lines || [];
    const total = lines.reduce((sum, l) => sum + Number(l.line_total || Number(l.quantity || 0) * Number(l.unit_price || 0)), 0);
    const paid = Number(order.payments_total || 0);
    const balance = Math.max(0, total - paid);
    return { total, paid, balance, lines };
  };

  const openPayModal = (order: RetailSaleOrder) => {
    const { balance } = getTotals(order);
    setPayingOrder(order);
    setPayAmount(balance.toFixed(2));
    setPayMethod("cash");
    setPayDate(new Date().toISOString().slice(0, 10));
  };

  const savePaymentForOrder = async () => {
    if (!payingOrder) return;
    const amount = Number(payAmount);
    const { balance } = getTotals(payingOrder);
    if (!Number.isFinite(amount) || amount <= 0) return alert("Enter a valid payment amount.");
    if (amount > balance + 0.01) return alert("Payment cannot exceed outstanding amount.");
    setSavingPayment(true);
    try {
      const insertPayload: Record<string, unknown> = {
        amount,
        paid_at: `${payDate}T12:00:00`,
        payment_status: "completed",
        payment_source: "pos_retail",
        transaction_id: payingOrder.id,
        processed_by: user?.id ?? null,
        retail_customer_id: null,
        ...(orgId ? { organization_id: orgId } : {}),
      };
      const { error } = await insertPaymentWithMethodCompat(supabase, insertPayload, payMethod);
      if (error) throw error;
      setPayingOrder(null);
      setPayAmount("");
      await fetchOrders();
    } catch (e) {
      alert(`Failed to record payment: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingPayment(false);
    }
  };

  const startEditOrder = (order: RetailSaleOrder) => {
    if (!canEditPosOrdersByRole) {
      alert("You are not authorized to edit POS orders.");
      return;
    }
    setEditingOrderId(order.id);
    setEditingOrderDate(new Date(order.sale_at).toISOString().slice(0, 16));
    setEditingOrderLines(
      (order.retail_sale_lines || []).map((line) => ({
        product_id: line.product_id || "",
        description: line.description || "",
        quantity: Number(line.quantity || 1),
        unit_price: Number(line.unit_price || 0),
        department_id: line.department_id || "",
      }))
    );
  };

  const saveEditedOrder = async () => {
    if (!editingOrderId) return;
    if (!canEditPosOrdersByRole) {
      alert("You are not authorized to edit POS orders.");
      return;
    }
    try {
      const saleAt = new Date(editingOrderDate).toISOString();
      const { error: saleErr } = await supabase.from("retail_sales").update({ sale_at: saleAt }).eq("id", editingOrderId);
      if (saleErr) throw saleErr;
      const { error: delErr } = await supabase.from("retail_sale_lines").delete().eq("sale_id", editingOrderId);
      if (delErr) throw delErr;

      const nextLines = editingOrderLines
        .filter((l) => (l.product_id || l.description.trim()) && Number(l.quantity) > 0)
        .map((l, idx) => ({
          sale_id: editingOrderId,
          line_no: idx + 1,
          product_id: l.product_id || null,
          description: l.description.trim() || productOptions.find((p) => p.id === l.product_id)?.name || "Item",
          quantity: Number(l.quantity),
          unit_price: Number(l.unit_price),
          line_total: Number(l.quantity) * Number(l.unit_price),
          department_id: l.department_id || null,
        }));
      if (nextLines.length > 0) {
        const { error: insErr } = await supabase.from("retail_sale_lines").insert(nextLines);
        if (insErr) throw insErr;
      }
      setEditingOrderId(null);
      setEditingOrderDate("");
      setEditingOrderLines([]);
      await fetchOrders();
      alert("Order updated.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to update order.";
      if (String(msg).toLowerCase().includes("row-level security") || String(msg).toLowerCase().includes("permission denied")) {
        alert("You are not authorized to edit POS orders.");
      } else {
        alert(msg);
      }
    }
  };

  const addEditLine = () => {
    const defaultProduct = productOptions[0];
    setEditingOrderLines((prev) => [
      ...prev,
      {
        product_id: defaultProduct?.id || "",
        description: defaultProduct?.name || "",
        quantity: 1,
        unit_price: Number(defaultProduct?.sales_price || 0),
        department_id: defaultProduct?.department_id || "",
      },
    ]);
  };

  const reverseOrder = async (order: RetailSaleOrder) => {
    if (!canReverse) {
      alert("You are not authorized to reverse POS orders.");
      return;
    }
    const ok = window.confirm(
      `Cancel / reverse order ${order.id.slice(0, 8)}? This will refund linked payments and return quantities to stock.`
    );
    if (!ok) return;
    try {
      setReversingOrderId(order.id);
      const { data: payRows, error: payErr } = await filterByOrganizationId(
        supabase
          .from("payments")
          .select("id,source_documents")
          .eq("transaction_id", order.id)
          .eq("payment_status", "completed"),
        orgId,
        superAdmin
      );
      if (payErr) throw payErr;
      for (const p of payRows || []) {
        const docs =
          p.source_documents && typeof p.source_documents === "object"
            ? {
                ...(p.source_documents as Record<string, unknown>),
                reversal: {
                  reversed_at: new Date().toISOString(),
                  reversed_by: user?.id ?? null,
                  order_id: order.id,
                },
              }
            : {
                reversal: {
                  reversed_at: new Date().toISOString(),
                  reversed_by: user?.id ?? null,
                  order_id: order.id,
                },
              };
        const { error: updErr } = await supabase
          .from("payments")
          .update({
            payment_status: "refunded",
            edited_at: new Date().toISOString(),
            edited_by_staff_id: user?.id ?? null,
            edited_by_name: user?.email ?? null,
            source_documents: docs,
          })
          .eq("id", p.id);
        if (updErr) throw updErr;
      }

      const restockRows = (order.retail_sale_lines || [])
        .filter((line) => line.product_id && Number(line.quantity || 0) > 0)
        .map((line) => ({
          product_id: line.product_id,
          source_type: "adjustment",
          source_id: order.id,
          movement_date: new Date().toISOString(),
          quantity_in: Number(line.quantity || 0),
          quantity_out: 0,
          note: `POS reversal for order ${order.id.slice(0, 8)}`,
        }));
      if (restockRows.length > 0) {
        const { error: stockErr } = await supabase.from("product_stock_movements").insert(restockRows);
        if (stockErr) throw stockErr;
      }

      const { error: saleErr } = await supabase
        .from("retail_sales")
        .update({
          payment_status: "refunded",
          amount_paid: 0,
          amount_due: 0,
          change_amount: 0,
        })
        .eq("id", order.id);
      if (saleErr) throw saleErr;

      await fetchOrders();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (String(msg).toLowerCase().includes("row-level security") || String(msg).toLowerCase().includes("permission denied")) {
        alert("You are not authorized to reverse POS orders.");
      } else {
        alert(`Failed to reverse order: ${msg}`);
      }
    } finally {
      setReversingOrderId(null);
    }
  };

  const printOrderReceipt = (order: RetailSaleOrder) => {
    const { total, paid, balance, lines } = getTotals(order, departmentTab === "all" ? undefined : departmentTab);
    const doc = window.open("", "_blank", "width=420,height=720");
    if (!doc) return alert("Allow popups to print receipt.");
    const lineHtml = lines
      .map(
        (line) =>
          `<div style="display:flex;justify-content:space-between;gap:8px;"><span>${Number(line.quantity || 0)}x ${line.description || "Item"}</span><span>${Number(
            line.line_total || Number(line.quantity || 0) * Number(line.unit_price || 0)
          ).toFixed(2)}</span></div>`
      )
      .join("");
    const methods =
      order.payment_methods && order.payment_methods.length > 0
        ? order.payment_methods.map((m) => formatPaymentMethodLabel(m)).join(", ")
        : "N/A";
    const html = `
      <html>
      <head>
        <title>Retail Receipt</title>
        <style>
          body{font-family:Arial,sans-serif;padding:12px;max-width:320px;margin:0 auto;color:#0f172a}
          .row{display:flex;justify-content:space-between;gap:8px}
          .muted{color:#64748b;font-size:12px}
          .line{border-top:1px dashed #cbd5e1;margin:8px 0}
        </style>
      </head>
      <body>
        <h3 style="margin:0 0 6px 0">Retail Receipt (Reprint)</h3>
        <div class="muted">Order: ${order.id.slice(0, 8)}</div>
        <div class="muted">Date: ${new Date(order.sale_at).toLocaleString()}</div>
        <div class="line"></div>
        ${lineHtml}
        <div class="line"></div>
        <div class="row"><strong>Total</strong><strong>${total.toFixed(2)}</strong></div>
        <div class="row muted"><span>Paid</span><span>${paid.toFixed(2)}</span></div>
        <div class="row muted"><span>Outstanding</span><span>${balance.toFixed(2)}</span></div>
        <div class="row muted"><span>Method</span><span>${methods}</span></div>
        <div class="line"></div>
        <div class="muted">Customer: ${order.customer_name || "Walk-in customer"}</div>
      </body>
      </html>
    `;
    doc.document.write(html);
    doc.document.close();
    doc.focus();
    doc.print();
  };

  const tabs = useMemo(() => {
    const deptIds = new Set<string>();
    for (const order of orders) {
      for (const line of order.retail_sale_lines || []) {
        if (line.department_id) deptIds.add(line.department_id);
      }
    }
    const usedDepartments = departmentOptions.filter((d) => deptIds.has(d.id));
    return [{ id: "all", name: "All departments" }, ...usedDepartments];
  }, [orders, departmentOptions]);

  const filteredOrders = useMemo(() => {
    if (departmentTab === "all") return orders;
    return orders
      .map((o) => ({
        ...o,
        retail_sale_lines: (o.retail_sale_lines || []).filter((l) => l.department_id === departmentTab),
      }))
      .filter((o) => o.retail_sale_lines.length > 0);
  }, [orders, departmentTab]);

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Retail POS Orders</h1>
            <PageNotes ariaLabel="Retail POS orders help">
              <p>Department tabs with edit and payment actions for recorded retail sales.</p>
            </PageNotes>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <select value={dateRange} onChange={(e) => setDateRange(e.target.value as DateRangeKey)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="last_30_days">Last 30 days</option>
            <option value="this_week">This week</option>
            <option value="this_month">This month</option>
            <option value="custom">Custom</option>
          </select>
          {dateRange === "custom" ? (
            <>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </>
          ) : null}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setDepartmentTab(tab.id)}
            className={`px-3 py-1.5 rounded-lg border text-sm ${
              departmentTab === tab.id
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
            }`}
          >
            {tab.name}
          </button>
        ))}
      </div>
      {!canEditPosOrdersByRole ? (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          POS order edits are disabled for your role ({role || "staff"}). Ask an admin/super admin to grant POS edit permission.
        </div>
      ) : null}

      {loading ? (
        <p className="text-slate-500 text-sm">Loading retail POS orders...</p>
      ) : filteredOrders.length === 0 ? (
        <p className="text-slate-500 text-sm">No orders for this period.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredOrders.map((order) => {
            const { total, paid, balance, lines } = getTotals(order, departmentTab === "all" ? undefined : departmentTab);
            return (
              <div key={order.id} className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="font-semibold text-slate-900">{order.customer_name || "Walk-in customer"}</p>
                  <span className="text-xs text-slate-500 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    {new Date(order.sale_at).toLocaleString()}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2">Order: <span className="font-mono">{order.id.slice(0, 8)}</span></p>
                <div className="text-sm text-slate-700 space-y-1">
                  {lines.map((line) => (
                    <p key={line.id}>
                      {Number(line.quantity || 0)} × {line.description || "Item"} - {Number(line.line_total || 0).toFixed(2)}
                    </p>
                  ))}
                </div>
                <div className="border-t pt-2 mt-2 text-xs text-slate-700">
                  <p>Total: {total.toFixed(2)}</p>
                  <p>Paid: {paid.toFixed(2)}</p>
                  <p>
                    Method:{" "}
                    {order.payment_methods && order.payment_methods.length > 0
                      ? order.payment_methods.map((m) => formatPaymentMethodLabel(m)).join(", ")
                      : "N/A"}
                  </p>
                  <p className="font-semibold">Outstanding: {balance.toFixed(2)}</p>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => printOrderReceipt(order)}
                    className="flex-1 rounded-lg border border-slate-200 bg-white text-slate-700 px-3 py-2 text-sm font-semibold hover:bg-slate-50"
                  >
                    Print Receipt
                  </button>
                  {balance > 0.01 ? (
                    <button type="button" onClick={() => openPayModal(order)} className="flex-1 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 px-3 py-2 text-sm font-semibold hover:bg-emerald-100">
                      Pay Outstanding
                    </button>
                  ) : null}
                  <button type="button" onClick={() => startEditOrder(order)} disabled={!canEditPosOrdersByRole} className="flex-1 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 px-3 py-2 text-sm font-semibold hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed">
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void reverseOrder(order)}
                    disabled={reversingOrderId === order.id || !canReverse}
                    className="flex-1 rounded-lg border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-sm font-semibold hover:bg-red-100 disabled:opacity-50"
                  >
                    {reversingOrderId === order.id ? "Reversing..." : "Cancel / Reverse"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editingOrderId ? (
        <div className="mt-6 bg-white rounded-xl border border-slate-200 p-4 md:p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-lg font-bold text-slate-900">Edit Retail POS Order</h2>
            <button
              type="button"
              onClick={() => {
                setEditingOrderId(null);
                setEditingOrderDate("");
                setEditingOrderLines([]);
              }}
              className="px-3 py-1.5 border border-slate-300 rounded-lg hover:bg-slate-50 text-sm"
            >
              Cancel
            </button>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-1">Transaction date & time</label>
            <input type="datetime-local" value={editingOrderDate} onChange={(e) => setEditingOrderDate(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="space-y-3">
            {editingOrderLines.map((line, index) => (
              <div key={`${editingOrderId}-${index}`} className="grid grid-cols-1 md:grid-cols-[1.5fr_1fr_110px_110px_auto] gap-2 items-center">
                <select
                  value={line.product_id}
                  onChange={(e) => {
                    const selected = productOptions.find((p) => p.id === e.target.value);
                    setEditingOrderLines((prev) =>
                      prev.map((row, i) =>
                        i === index
                          ? {
                              ...row,
                              product_id: e.target.value,
                              description: selected?.name || row.description,
                              unit_price: Number(selected?.sales_price || row.unit_price),
                              department_id: selected?.department_id || row.department_id,
                            }
                          : row
                      )
                    );
                  }}
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Select product</option>
                  {productOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={line.description}
                  onChange={(e) =>
                    setEditingOrderLines((prev) => prev.map((row, i) => (i === index ? { ...row, description: e.target.value } : row)))
                  }
                  placeholder="Description"
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
                <input
                  type="number"
                  min={1}
                  value={line.quantity}
                  onChange={(e) =>
                    setEditingOrderLines((prev) => prev.map((row, i) => (i === index ? { ...row, quantity: Number(e.target.value || 1) } : row)))
                  }
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={line.unit_price}
                  onChange={(e) =>
                    setEditingOrderLines((prev) => prev.map((row, i) => (i === index ? { ...row, unit_price: Number(e.target.value || 0) } : row)))
                  }
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setEditingOrderLines((prev) => prev.filter((_, i) => i !== index))}
                  className="px-3 py-2 border border-red-200 text-red-700 rounded-lg hover:bg-red-50 text-sm"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={addEditLine} className="px-3 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 text-sm">
              Add line
            </button>
            <button type="button" onClick={() => void saveEditedOrder()} className="px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm">
              Save changes
            </button>
          </div>
        </div>
      ) : null}

      {payingOrder ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !savingPayment && setPayingOrder(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Settle Retail POS Order</h3>
            <p className="text-sm text-slate-600 mb-3">
              Order: <span className="font-mono">{payingOrder.id.slice(0, 8)}</span>
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Amount</label>
                <input type="number" step="0.01" min="0" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Payment date</label>
                <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Payment method</label>
                <select value={payMethod} onChange={(e) => setPayMethod(e.target.value as PaymentMethodCode)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  {PAYMENT_METHOD_SELECT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setPayingOrder(null)} disabled={savingPayment} className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">
                  Cancel
                </button>
                <button type="button" onClick={() => void savePaymentForOrder()} disabled={savingPayment} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                  {savingPayment ? "Saving..." : "Record Payment"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
