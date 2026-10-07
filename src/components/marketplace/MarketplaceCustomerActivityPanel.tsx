import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, Check, RefreshCw, Star } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

const db = supabase as any;

type OrderItem = { id: string; listing_id: string | null; title: string; quantity: number; total_amount: number };
type MarketplaceOrder = {
  id: string;
  order_number: string;
  status: string;
  gross_amount: number;
  currency: string;
  payment_reference: string | null;
  created_at: string;
  marketplace_order_items: OrderItem[] | null;
};
type MarketplaceReview = { id: string; order_item_id: string; rating: number; comment: string | null };
type MarketplaceNotification = { id: string; title: string; body: string; created_at: string; read_at: string | null };
type ReviewDraft = { rating: number; comment: string };

const money = (amount: number, currency: string) => `${currency} ${Number(amount || 0).toLocaleString()}`;
const statusClass = (status: string) => ({
  pending: "bg-amber-100 text-amber-800",
  confirmed: "bg-sky-100 text-sky-800",
  paid: "bg-emerald-100 text-emerald-800",
  fulfilled: "bg-indigo-100 text-indigo-800",
  cancelled: "bg-slate-200 text-slate-700",
  refunded: "bg-rose-100 text-rose-800",
}[status] || "bg-slate-100 text-slate-700");

export function MarketplaceCustomerActivityPanel({ refreshKey }: { refreshKey?: string }) {
  const { user } = useAuth();
  const [orders, setOrders] = useState<MarketplaceOrder[]>([]);
  const [reviews, setReviews] = useState<MarketplaceReview[]>([]);
  const [notifications, setNotifications] = useState<MarketplaceNotification[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submittingItemId, setSubmittingItemId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    setLoading(true);
    const customerRes = await db.from("marketplace_customers").select("id").eq("user_id", user.id).maybeSingle();
    if (customerRes.error) { setLoading(false); setMessage(customerRes.error.message); return; }
    const notificationsPromise = db.from("marketplace_notifications")
      .select("id,title,body,created_at,read_at")
      .eq("recipient_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(12);
    if (!customerRes.data?.id) {
      const notificationsRes = await notificationsPromise;
      setOrders([]); setReviews([]); setNotifications((notificationsRes.data || []) as MarketplaceNotification[]);
      setLoading(false);
      if (notificationsRes.error) setMessage(notificationsRes.error.message);
      return;
    }
    const [ordersRes, reviewsRes, notificationsRes] = await Promise.all([
      db.from("marketplace_orders")
        .select("id,order_number,status,gross_amount,currency,payment_reference,created_at,marketplace_order_items(id,listing_id,title,quantity,total_amount)")
        .eq("customer_id", customerRes.data.id)
        .order("created_at", { ascending: false })
        .limit(25),
      db.from("marketplace_reviews").select("id,order_item_id,rating,comment").eq("customer_id", customerRes.data.id),
      notificationsPromise,
    ]);
    setLoading(false);
    if (ordersRes.error || reviewsRes.error || notificationsRes.error) {
      setMessage((ordersRes.error || reviewsRes.error || notificationsRes.error).message);
      return;
    }
    setOrders((ordersRes.data || []) as MarketplaceOrder[]);
    setReviews((reviewsRes.data || []) as MarketplaceReview[]);
    setNotifications((notificationsRes.data || []) as MarketplaceNotification[]);
  }, [user?.id]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const reviewsByItem = useMemo(() => Object.fromEntries(reviews.map((review) => [review.order_item_id, review])), [reviews]);
  const getDraft = (itemId: string) => drafts[itemId] || {
    rating: reviewsByItem[itemId]?.rating || 5,
    comment: reviewsByItem[itemId]?.comment || "",
  };

  const updateDraft = (itemId: string, update: Partial<ReviewDraft>) => {
    setDrafts((current) => ({ ...current, [itemId]: { ...getDraft(itemId), ...update } }));
  };

  const submitReview = async (itemId: string) => {
    const draft = getDraft(itemId);
    setSubmittingItemId(itemId); setMessage(null);
    const result = await db.rpc("marketplace_submit_review", {
      p_order_item_id: itemId,
      p_rating: draft.rating,
      p_comment: draft.comment,
    });
    setSubmittingItemId(null);
    if (result.error) { setMessage(result.error.message); return; }
    setMessage("Your review has been saved.");
    await load();
  };

  const markRead = async (notificationId: string) => {
    const result = await db.rpc("marketplace_mark_notification_read", { p_notification_id: notificationId });
    if (result.error) { setMessage(result.error.message); return; }
    setNotifications((current) => current.map((notification) => notification.id === notificationId ? { ...notification, read_at: notification.read_at || new Date().toISOString() } : notification));
  };

  if (!user) return null;
  return <section className="grid gap-5 border-t border-slate-200 pt-6 lg:grid-cols-[1fr_320px]">
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-900">My marketplace orders</h2><p className="mt-1 text-sm text-slate-600">See payment references, print receipts, and review items after fulfilment.</p></div><button type="button" onClick={() => void load()} disabled={loading} className="app-btn-secondary"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button></div>
      {message && <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700" role="status">{message}</p>}
      <div className="mt-4 space-y-3">{orders.map((order) => <article key={order.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="font-semibold text-slate-900">{order.order_number}</h3><span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${statusClass(order.status)}`}>{order.status}</span></div><p className="mt-1 text-xs text-slate-500">{new Date(order.created_at).toLocaleString()}</p></div><div className="text-right"><p className="font-semibold text-slate-900">{money(order.gross_amount, order.currency)}</p>{order.payment_reference && <p className="mt-1 text-xs text-slate-500">Payment ref: {order.payment_reference}</p>}<button type="button" onClick={() => window.print()} className="mt-2 text-sm font-medium text-indigo-700">Print receipt</button></div></div><ul className="mt-3 space-y-2 border-t border-slate-100 pt-3">{(order.marketplace_order_items || []).map((item) => { const review = reviewsByItem[item.id]; const draft = getDraft(item.id); return <li key={item.id} className="text-sm text-slate-700"><div className="flex flex-wrap items-start justify-between gap-2"><span>{item.quantity} × {item.title}</span><span>{money(item.total_amount, order.currency)}</span></div>{order.status === "fulfilled" && item.listing_id && <div className="mt-3 rounded-lg bg-slate-50 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium text-slate-800">{review ? "Update your review" : "Rate this item"}</p>{review && <span className="inline-flex items-center gap-1 text-amber-600"><Star className="h-4 w-4 fill-current" /> {review.rating}/5</span>}</div><div className="mt-2 grid gap-2 sm:grid-cols-[130px_1fr_auto]"><select value={draft.rating} onChange={(event) => updateDraft(item.id, { rating: Number(event.target.value) })} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">{[5, 4, 3, 2, 1].map((rating) => <option key={rating} value={rating}>{rating} star{rating === 1 ? "" : "s"}</option>)}</select><input value={draft.comment} onChange={(event) => updateDraft(item.id, { comment: event.target.value })} maxLength={500} placeholder="Share a short comment (optional)" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" /><button type="button" onClick={() => void submitReview(item.id)} disabled={submittingItemId === item.id} className="app-btn-secondary">{submittingItemId === item.id ? "Saving…" : "Save review"}</button></div></div>}</li>; })}</ul></article>)}{!loading && orders.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">You have not placed a marketplace order yet.</p>}</div>
    </div>
    <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-2"><Bell className="h-5 w-5 text-indigo-700" /><h2 className="font-semibold text-slate-900">Order updates</h2></div><div className="mt-3 space-y-3">{notifications.map((notification) => <article key={notification.id} className={`rounded-lg border p-3 ${notification.read_at ? "border-slate-200 bg-white" : "border-indigo-200 bg-indigo-50"}`}><div className="flex gap-2"><div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-900">{notification.title}</p><p className="mt-1 text-sm text-slate-600">{notification.body}</p><p className="mt-2 text-xs text-slate-500">{new Date(notification.created_at).toLocaleString()}</p></div>{!notification.read_at && <button type="button" onClick={() => void markRead(notification.id)} className="shrink-0 rounded p-1 text-indigo-700 hover:bg-indigo-100" aria-label="Mark update read"><Check className="h-4 w-4" /></button>}</div></article>)}{!loading && notifications.length === 0 && <p className="text-sm text-slate-500">Order and payment updates will appear here.</p>}</div></aside>
  </section>;
}
