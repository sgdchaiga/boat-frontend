import { useEffect, useMemo, useState } from "react";
import { Clock } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { Database } from "../lib/database.types";
import { computeRangeInTimezone, type DateRangeKey } from "../lib/timezone";
import { useAuth } from "../contexts/AuthContext";
import { filterByOrganizationId } from "../lib/supabaseOrgFilter";
import { PageNotes } from "./common/PageNotes";
import { getNextOrderStatus } from "../lib/hotelPosOrderStatus";
import {
  type PaymentMethodCode,
  PAYMENT_METHOD_SELECT_OPTIONS,
  insertPaymentWithMethodCompat,
} from "../lib/paymentMethod";

type Department = Database["public"]["Tables"]["departments"]["Row"];

interface SaunaOrderItem {
  quantity: number;
  notes?: string | null;
  products: { name: string; department_id: string | null; sales_price?: number | null };
}

interface SaunaOrder {
  id: string;
  order_status: string;
  table_number: string | null;
  customer_name?: string | null;
  created_at: string;
  created_by: string | null;
  kitchen_order_items: SaunaOrderItem[];
  payments_total?: number;
}

export function SaunaOrdersPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [orders, setOrders] = useState<SaunaOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saunaDepartment, setSaunaDepartment] = useState<Department | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [productOptions, setProductOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [payingOrder, setPayingOrder] = useState<SaunaOrder | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<PaymentMethodCode>("cash");
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [savingPayment, setSavingPayment] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [editingOrderDate, setEditingOrderDate] = useState("");
  const [editingOrderItems, setEditingOrderItems] = useState<Array<{ product_id: string; quantity: number; notes: string }>>([]);
  const [paymentFilter, setPaymentFilter] = useState<"all" | "outstanding" | "partially_paid" | "paid" | "unpaid">("all");

  const [dateRange, setDateRange] = useState<DateRangeKey>("last_30_days");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  useEffect(() => {
    fetchOrders();
  }, [dateRange, customFrom, customTo, orgId, superAdmin]);

  const updateStatus = async (orderId: string, newStatus: "preparing" | "ready" | "served") => {
    setUpdatingId(orderId);
    try {
      const { error } = await supabase.from("kitchen_orders").update({ order_status: newStatus }).eq("id", orderId);
      if (error) throw error;
      await fetchOrders();
    } catch (err) {
      console.error("Sauna update status error:", err);
      alert("Failed to update order status.");
    } finally {
      setUpdatingId(null);
    }
  };

  const fetchOrders = async () => {
    try {
      setLoading(true);
      const { from, to } = computeRangeInTimezone(dateRange, customFrom, customTo);
      const fromIso = from.toISOString();
      const toIso = to.toISOString();

      const [departmentsRes, ordersRes, productsRes] = await Promise.all([
        filterByOrganizationId(supabase.from("departments").select("id,name"), orgId, superAdmin),
        filterByOrganizationId(
          supabase
            .from("kitchen_orders")
            .select(
              `
            id,
            order_status,
            table_number,
            customer_name,
            created_at,
            created_by,
            kitchen_order_items(quantity, notes, product_id)
          `
            )
            .gte("created_at", fromIso)
            .lt("created_at", toIso)
            .order("created_at", { ascending: true }),
          orgId,
          superAdmin
        ),
        filterByOrganizationId(supabase.from("products").select("id, name, department_id, sales_price"), orgId, superAdmin),
      ]);

      if (departmentsRes.error) console.error("Sauna departments error:", departmentsRes.error);
      if (ordersRes.error) {
        console.error("Sauna orders error:", ordersRes.error);
        setLoading(false);
        return;
      }

      const departments = (departmentsRes.data || []) as Department[];
      const saunaDept =
        departments.find((d) => {
          const name = d.name.toLowerCase();
          return name.includes("sauna") || name.includes("spa");
        }) || null;
      setSaunaDepartment(saunaDept);

      const productMap = Object.fromEntries(
        ((productsRes?.data || []) as { id: string; name: string; department_id: string | null; sales_price: number | null }[]).map((p) => [p.id, p])
      );
      setProductOptions(((productsRes?.data || []) as { id: string; name: string }[]).map((p) => ({ id: p.id, name: p.name })));
      const rawOrders = (ordersRes.data || []) as any[];
      const data = rawOrders.map((o) => ({
        ...o,
        kitchen_order_items: (o.kitchen_order_items || []).map((i: any) => ({
          ...i,
          products: i.product_id && productMap[i.product_id]
            ? { name: productMap[i.product_id].name, department_id: productMap[i.product_id].department_id, sales_price: productMap[i.product_id].sales_price }
            : { name: "Item", department_id: null, sales_price: 0 },
        })),
      })) as SaunaOrder[];

      const orderIds = data.map((o) => o.id);
      let paymentsMap: Record<string, number> = {};
      if (orderIds.length > 0) {
        const { data: paymentsData, error: payError } = await filterByOrganizationId(
          supabase.from("payments").select("amount, payment_status, transaction_id").in("transaction_id", orderIds),
          orgId,
          superAdmin
        );
        if (payError) {
          console.error("Sauna payments error:", payError);
        } else {
          (paymentsData || []).forEach((p: any) => {
            if (p.payment_status === "completed" && p.transaction_id) {
              const key = p.transaction_id as string;
              paymentsMap[key] = (paymentsMap[key] || 0) + Number(p.amount);
            }
          });
        }
      }

      const withPayments = data.map((o) => ({
        ...o,
        payments_total: paymentsMap[o.id] || 0,
      }));

      setOrders(withPayments);
    } finally {
      setLoading(false);
    }
  };

  const getOrderTotals = (order: SaunaOrder) => {
    const total = order.kitchen_order_items.reduce((sum, item) => {
      const price = item.products?.sales_price ?? 0;
      return sum + item.quantity * Number(price);
    }, 0);
    const paid = Number(order.payments_total || 0);
    const balance = Math.max(0, total - paid);
    return { total, paid, balance };
  };

  const paymentBucket = (order: SaunaOrder): "paid" | "unpaid" | "partially_paid" => {
    const { total, paid } = getOrderTotals(order);
    if (paid <= 0.01) return "unpaid";
    if (paid + 0.01 < total) return "partially_paid";
    return "paid";
  };

  const openPayModal = (order: SaunaOrder) => {
    const { balance } = getOrderTotals(order);
    setPayingOrder(order);
    setPayAmount(balance.toFixed(2));
    setPayMethod("cash");
    setPayDate(new Date().toISOString().slice(0, 10));
  };

  const savePaymentForOrder = async () => {
    if (!payingOrder) return;
    const amount = Number(payAmount);
    const { balance } = getOrderTotals(payingOrder);
    if (!Number.isFinite(amount) || amount <= 0) {
      alert("Enter a valid payment amount.");
      return;
    }
    if (amount > balance + 0.01) {
      alert("Payment cannot exceed outstanding amount.");
      return;
    }
    setSavingPayment(true);
    try {
      const insertPayload: Record<string, unknown> = {
        amount,
        paid_at: `${payDate}T12:00:00`,
        payment_status: "completed",
        payment_source: "pos_hotel",
        transaction_id: payingOrder.id,
        processed_by: user?.id ?? null,
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

  const startEditOrder = (order: SaunaOrder) => {
    setEditingOrderId(order.id);
    setEditingOrderDate(new Date(order.created_at).toISOString().slice(0, 16));
    setEditingOrderItems(
      (order.kitchen_order_items || []).map((item) => ({
        product_id: String((item as any).product_id || ""),
        quantity: Number(item.quantity || 1),
        notes: String(item.notes || ""),
      }))
    );
  };

  const addEditingOrderItem = () => {
    const fallbackProductId = productOptions[0]?.id || "";
    setEditingOrderItems((prev) => [...prev, { product_id: fallbackProductId, quantity: 1, notes: "" }]);
  };

  const saveEditedOrder = async () => {
    if (!editingOrderId) return;
    try {
      const iso = new Date(editingOrderDate).toISOString();
      const { error: orderErr } = await supabase.from("kitchen_orders").update({ created_at: iso }).eq("id", editingOrderId);
      if (orderErr) throw orderErr;
      const { error: delErr } = await supabase.from("kitchen_order_items").delete().eq("order_id", editingOrderId);
      if (delErr) throw delErr;
      const nextItems = editingOrderItems
        .filter((item) => item.product_id && Number(item.quantity) > 0)
        .map((item) => ({
          order_id: editingOrderId,
          product_id: item.product_id,
          quantity: Number(item.quantity),
          notes: item.notes.trim() || null,
        }));
      if (nextItems.length > 0) {
        const { error: insErr } = await supabase.from("kitchen_order_items").insert(nextItems);
        if (insErr) throw insErr;
      }
      setEditingOrderId(null);
      setEditingOrderDate("");
      setEditingOrderItems([]);
      await fetchOrders();
      alert("Order updated.");
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to update order.");
    }
  };

  const getElapsed = (time: string) => {
    const minutes = Math.floor((Date.now() - new Date(time).getTime()) / 60000);
    if (minutes < 1) return "< 1 min";
    if (minutes === 1) return "1 min";
    return `${minutes} mins`;
  };

  const renderStaffName = (order: SaunaOrder) => order.created_by || "Unknown";

  const filteredOrders = useMemo(() => {
    if (!saunaDepartment) return [];
    const byDepartment = orders
      .map((o) => {
        const saunaItems = (o.kitchen_order_items || []).filter((it) => it.products?.department_id === saunaDepartment.id);
        return { ...o, kitchen_order_items: saunaItems };
      })
      .filter((o) => (o.kitchen_order_items || []).length > 0);
    return byDepartment.filter((o) => {
      const bucket = paymentBucket(o);
      if (paymentFilter === "all") return true;
      if (paymentFilter === "outstanding") return bucket !== "paid";
      return bucket === paymentFilter;
    });
  }, [orders, saunaDepartment, paymentFilter]);

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 flex items-center gap-2">
              <Clock className="w-6 h-6 text-cyan-600" />
              Sauna Orders
            </h1>
            <PageNotes ariaLabel="Sauna orders help">
              <p>Sauna order queue for the department configured for this screen.</p>
            </PageNotes>
          </div>
          {saunaDepartment && (
            <p className="text-xs text-slate-500">
              Showing orders for department: <strong>{saunaDepartment.name}</strong>
            </p>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
          <select value={dateRange} onChange={(e) => setDateRange(e.target.value as DateRangeKey)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="last_30_days">Last 30 days</option>
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
          <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value as typeof paymentFilter)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="all">All payments</option>
            <option value="outstanding">Outstanding</option>
            <option value="partially_paid">Partially paid</option>
            <option value="paid">Paid</option>
            <option value="unpaid">Unpaid</option>
          </select>
          {dateRange === "custom" && (
            <div className="flex gap-2 items-center">
              <input type="date" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              <span className="text-slate-500 text-xs">to</span>
              <input type="date" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-slate-500 text-sm">Loading sauna orders...</p>
      ) : filteredOrders.length === 0 ? (
        <p className="text-slate-500 text-sm">No sauna orders for this period.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredOrders.map((order) => (
            <div key={order.id} className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="font-semibold text-slate-900">{order.customer_name || `Order #${order.id.slice(0, 6)}`}</p>
                  <span className="text-xs text-slate-500">{getElapsed(order.created_at)}</span>
                </div>
                <p className="text-xs text-slate-500 mb-1">
                  Table: {order.table_number || "POS"} • By: {renderStaffName(order)}
                </p>
                <p className="text-xs text-slate-500 mb-1">
                  Transaction date: {new Date(order.created_at).toLocaleString()}
                </p>
                <p className="text-xs text-slate-500 mb-2">
                  Status: <span className="font-semibold">{order.order_status}</span>
                </p>
                <div className="text-sm text-slate-700 space-y-1">
                  {orders.length > 0 &&
                    order.kitchen_order_items?.map((item, idx) => (
                      <p key={idx}>
                        {item.quantity} × {item.products?.name || "Item"}
                        {item.notes ? <span className="text-xs text-red-500"> ({item.notes})</span> : null}
                      </p>
                    ))}
                </div>
                <div className="border-t pt-2 mt-2 text-xs text-slate-700">
                  {(() => {
                    const total = order.kitchen_order_items.reduce((sum, item) => {
                      const price = item.products?.sales_price ?? 0;
                      return sum + item.quantity * Number(price);
                    }, 0);
                    const paid = order.payments_total || 0;
                    const balance = total - paid;
                    return (
                      <>
                        <p>Total: {total.toFixed(2)}</p>
                        <p>Paid: {paid.toFixed(2)}</p>
                        <p className="font-semibold">Outstanding: {balance.toFixed(2)}</p>
                      </>
                    );
                  })()}
                </div>
              </div>

              <div className="mt-3 flex gap-2">
                {getOrderTotals(order).balance > 0.01 ? (
                  <button type="button" onClick={() => openPayModal(order)} className="flex-1 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 px-3 py-2 text-sm font-semibold hover:bg-emerald-100">
                    Pay Outstanding
                  </button>
                ) : null}
                <button type="button" onClick={() => startEditOrder(order)} className="flex-1 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 px-3 py-2 text-sm font-semibold hover:bg-slate-100">
                  Edit
                </button>
                {order.order_status === "pending" ? (
                  <button
                    type="button"
                    onClick={() => {
                      const next = getNextOrderStatus(order.order_status, "bar");
                      if (next === "preparing") void updateStatus(order.id, next);
                    }}
                    disabled={updatingId === order.id}
                    className="flex-1 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 px-3 py-2 text-sm font-semibold hover:bg-blue-100 disabled:opacity-50"
                  >
                    {updatingId === order.id ? "…" : "Preparing"}
                  </button>
                ) : null}
                {order.order_status === "preparing" ? (
                  <button
                    type="button"
                    onClick={() => {
                      const next = getNextOrderStatus(order.order_status, "bar");
                      if (next === "ready") void updateStatus(order.id, next);
                    }}
                    disabled={updatingId === order.id}
                    className="flex-1 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 px-3 py-2 text-sm font-semibold hover:bg-emerald-100 disabled:opacity-50"
                  >
                    {updatingId === order.id ? "…" : "Ready"}
                  </button>
                ) : null}
                {order.order_status === "ready" ? (
                  <button
                    type="button"
                    onClick={() => {
                      const next = getNextOrderStatus(order.order_status, "bar");
                      if (next === "served") void updateStatus(order.id, next);
                    }}
                    disabled={updatingId === order.id}
                    className="flex-1 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 px-3 py-2 text-sm font-semibold hover:bg-slate-100 disabled:opacity-50"
                  >
                    {updatingId === order.id ? "…" : "Served"}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {editingOrderId ? (
        <div className="mt-6 bg-white rounded-xl border border-slate-200 p-4 md:p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-lg font-bold text-slate-900">Edit Sauna Order</h2>
            <button
              type="button"
              onClick={() => {
                setEditingOrderId(null);
                setEditingOrderDate("");
                setEditingOrderItems([]);
              }}
              className="px-3 py-1.5 border border-slate-300 rounded-lg hover:bg-slate-50 text-sm"
            >
              Cancel
            </button>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-1">Order date & time</label>
            <input type="datetime-local" value={editingOrderDate} onChange={(e) => setEditingOrderDate(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="space-y-3">
            {editingOrderItems.map((item, index) => (
              <div key={`${editingOrderId}-${index}`} className="grid grid-cols-1 md:grid-cols-[1.5fr_120px_1fr_auto] gap-2 items-center">
                <select
                  value={item.product_id}
                  onChange={(e) =>
                    setEditingOrderItems((prev) =>
                      prev.map((row, i) => (i === index ? { ...row, product_id: e.target.value } : row))
                    )
                  }
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
                  type="number"
                  min={1}
                  value={item.quantity}
                  onChange={(e) =>
                    setEditingOrderItems((prev) =>
                      prev.map((row, i) => (i === index ? { ...row, quantity: Number(e.target.value || 1) } : row))
                    )
                  }
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
                <input
                  type="text"
                  value={item.notes}
                  onChange={(e) =>
                    setEditingOrderItems((prev) =>
                      prev.map((row, i) => (i === index ? { ...row, notes: e.target.value } : row))
                    )
                  }
                  placeholder="Notes"
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setEditingOrderItems((prev) => prev.filter((_, i) => i !== index))}
                  className="px-3 py-2 border border-red-200 text-red-700 rounded-lg hover:bg-red-50 text-sm"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={addEditingOrderItem} className="px-3 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 text-sm">
              Add item
            </button>
            <button type="button" onClick={() => void saveEditedOrder()} className="px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm">
              Save changes
            </button>
          </div>
        </div>
      ) : null}

      {payingOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !savingPayment && setPayingOrder(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Settle Sauna Order</h3>
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
      )}
    </div>
  );
}
