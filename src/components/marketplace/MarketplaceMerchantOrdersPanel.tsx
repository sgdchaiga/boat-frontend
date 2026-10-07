import { useCallback, useEffect, useState } from "react";
import { Bell, Check, PackageCheck, RefreshCw, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";

const db = supabase as any;

type Customer = { full_name: string; phone: string | null };
type OrderItem = { id: string; title: string; quantity: number; unit_price: number; total_amount: number };
type MarketplaceOrder = {
  id: string;
  order_number: string;
  status: "pending" | "confirmed" | "paid" | "fulfilled" | "cancelled" | "refunded";
  gross_amount: number;
  currency: string;
  created_at: string;
  confirmed_at: string | null;
  fulfilled_at: string | null;
  cancelled_reason: string | null;
  merchant_note: string | null;
  marketplace_customers: Customer | Customer[] | null;
  marketplace_order_items: OrderItem[] | null;
};
type MarketplaceNotification = { id: string; title: string; body: string; created_at: string };

const money = (value: number, currency: string) => `${currency} ${Number(value || 0).toLocaleString()}`;
const statusClass: Record<MarketplaceOrder["status"], string> = {
  pending: "bg-amber-100 text-amber-800",
  confirmed: "bg-sky-100 text-sky-800",
  paid: "bg-emerald-100 text-emerald-800",
  fulfilled: "bg-indigo-100 text-indigo-800",
  cancelled: "bg-slate-200 text-slate-700",
  refunded: "bg-rose-100 text-rose-800",
};

export function MarketplaceMerchantOrdersPanel({ merchantId, organizationId }: { merchantId: string; organizationId: string }) {
  const [orders, setOrders] = useState<MarketplaceOrder[]>([]);
  const [notifications, setNotifications] = useState<MarketplaceNotification[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [result, notificationsResult] = await Promise.all([
      db.from("marketplace_orders")
        .select("id,order_number,status,gross_amount,currency,created_at,confirmed_at,fulfilled_at,cancelled_reason,merchant_note,marketplace_customers(full_name,phone),marketplace_order_items(id,title,quantity,unit_price,total_amount)")
        .eq("merchant_id", merchantId)
        .order("created_at", { ascending: false })
        .limit(50),
      db.from("marketplace_notifications").select("id,title,body,created_at")
        .eq("organization_id", organizationId)
        .is("recipient_user_id", null)
        .is("read_at", null)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);
    setLoading(false);
    if (result.error || notificationsResult.error) { setMessage((result.error || notificationsResult.error).message); return; }
    setOrders((result.data || []) as MarketplaceOrder[]);
    setNotifications((notificationsResult.data || []) as MarketplaceNotification[]);
  }, [merchantId, organizationId]);

  useEffect(() => { void load(); }, [load]);

  const updateOrder = async (order: MarketplaceOrder, action: "confirm" | "fulfil" | "cancel") => {
    const note = notes[order.id] || "";
    if (action === "cancel" && !note.trim()) { setMessage("Add a cancellation reason before cancelling the order."); return; }
    setBusyId(order.id); setMessage(null);
    const result = await db.rpc("marketplace_merchant_update_order_status", { p_order_id: order.id, p_action: action, p_note: note || null });
    setBusyId(null);
    if (result.error) { setMessage(result.error.message); return; }
    setNotes((current) => ({ ...current, [order.id]: "" }));
    setMessage(`Order ${order.order_number} updated.`);
    await load();
  };

  const markNotificationRead = async (notificationId: string) => {
    const result = await db.rpc("marketplace_mark_organization_notification_read", { p_notification_id: notificationId });
    if (result.error) { setMessage(result.error.message); return; }
    setNotifications((current) => current.filter((notification) => notification.id !== notificationId));
  };

  return <section className="mt-6 border-t border-indigo-200 pt-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold text-slate-900">Marketplace orders</h3><p className="mt-1 text-sm text-slate-600">Confirm incoming requests, fulfil paid orders, or cancel unpaid orders. Linked retail products reduce stock only on fulfilment.</p></div><button type="button" onClick={() => void load()} disabled={loading} className="app-btn-secondary"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button></div>
    {message && <p className="mt-3 text-sm text-slate-700" role="status">{message}</p>}
    {notifications.length > 0 && <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 p-3"><div className="flex items-center gap-2 text-sm font-semibold text-indigo-950"><Bell className="h-4 w-4" /> {notifications.length} new marketplace update{notifications.length === 1 ? "" : "s"}</div><div className="mt-2 space-y-2">{notifications.map((notification) => <div key={notification.id} className="flex items-start justify-between gap-3 text-sm"><div><p className="font-medium text-slate-800">{notification.title}</p><p className="text-slate-600">{notification.body}</p></div><button type="button" onClick={() => void markNotificationRead(notification.id)} className="shrink-0 text-indigo-700">Mark read</button></div>)}</div></div>}
    <div className="mt-4 space-y-3">{orders.map((order) => {
      const customer = Array.isArray(order.marketplace_customers) ? order.marketplace_customers[0] : order.marketplace_customers;
      const items = order.marketplace_order_items || [];
      const isBusy = busyId === order.id;
      return <article key={order.id} className="rounded-lg border border-slate-200 bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-slate-900">{order.order_number}</p><span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${statusClass[order.status]}`}>{order.status}</span></div><p className="mt-1 text-sm text-slate-600">{customer?.full_name || "Marketplace customer"}{customer?.phone ? ` · ${customer.phone}` : ""} · {new Date(order.created_at).toLocaleString()}</p></div><p className="font-semibold text-slate-900">{money(order.gross_amount, order.currency)}</p></div><ul className="mt-3 space-y-1 text-sm text-slate-700">{items.map((item) => <li key={item.id}>{item.quantity} × {item.title} <span className="text-slate-500">({money(item.total_amount, order.currency)})</span></li>)}</ul>{order.cancelled_reason && <p className="mt-3 text-sm text-slate-600">Cancellation reason: {order.cancelled_reason}</p>}<textarea value={notes[order.id] ?? order.merchant_note ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [order.id]: event.target.value }))} placeholder={order.status === "pending" || order.status === "confirmed" ? "Optional merchant note; required to cancel" : "Fulfilment note (optional)"} className="mt-3 min-h-16 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /><div className="mt-3 flex flex-wrap gap-2">{!order.confirmed_at && !["cancelled", "fulfilled", "refunded"].includes(order.status) && <button type="button" disabled={isBusy} onClick={() => void updateOrder(order, "confirm")} className="app-btn-secondary"><Check className="h-4 w-4" /> Confirm</button>}{order.status === "paid" && <button type="button" disabled={isBusy} onClick={() => void updateOrder(order, "fulfil")} className="app-btn-primary"><PackageCheck className="h-4 w-4" /> Fulfil &amp; deduct stock</button>}{["pending", "confirmed"].includes(order.status) && <button type="button" disabled={isBusy} onClick={() => void updateOrder(order, "cancel")} className="app-btn-secondary text-rose-700"><XCircle className="h-4 w-4" /> Cancel</button>}</div></article>;
    })}{!loading && orders.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">No marketplace orders yet.</p>}</div>
  </section>;
}
