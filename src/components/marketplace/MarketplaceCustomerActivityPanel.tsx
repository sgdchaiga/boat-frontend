import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, Check, Printer, RefreshCw, Smartphone, Star } from "lucide-react";
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
type ManualMomoPayment = {
  payment_request_id: string;
  payment_reference: string;
  amount: number;
  currency: string;
  status: "awaiting_submission" | "submitted";
  recipient_name: string;
  recipient_phone: string;
  recipient_network: "mtn" | "airtel";
  payment_instructions: string | null;
};
type ManualMomoDraft = { phone: string; network: "mtn" | "airtel"; transactionId: string };

const money = (amount: number, currency: string) => `${currency} ${Number(amount || 0).toLocaleString()}`;
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character] || character));
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
  const [manualPayments, setManualPayments] = useState<Record<string, ManualMomoPayment>>({});
  const [manualDrafts, setManualDrafts] = useState<Record<string, ManualMomoDraft>>({});
  const [manualActionOrderId, setManualActionOrderId] = useState<string | null>(null);

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

  const manualDraftFor = (orderId: string): ManualMomoDraft => manualDrafts[orderId] || {
    phone: user?.phone || "",
    network: "mtn",
    transactionId: "",
  };

  const updateManualDraft = (orderId: string, update: Partial<ManualMomoDraft>) => {
    setManualDrafts((current) => ({ ...current, [orderId]: { ...manualDraftFor(orderId), ...update } }));
  };

  const showManualPaymentDetails = async (order: MarketplaceOrder) => {
    const draft = manualDraftFor(order.id);
    if (!draft.phone.trim()) { setMessage("Enter the mobile money number used for this payment."); return; }
    setManualActionOrderId(order.id); setMessage(null);
    const result = await db.rpc("marketplace_start_manual_momo_payment", {
      p_order_id: order.id,
      p_phone_number: draft.phone,
      p_network: draft.network,
    });
    setManualActionOrderId(null);
    if (result.error) { setMessage(result.error.message); return; }
    setManualPayments((current) => ({ ...current, [order.id]: result.data as ManualMomoPayment }));
  };

  const alertBoatOfManualPayment = async (order: MarketplaceOrder) => {
    const payment = manualPayments[order.id];
    const draft = manualDraftFor(order.id);
    if (!payment || !draft.transactionId.trim()) { setMessage("Enter the Mobile Money transaction ID from the payment message."); return; }
    setManualActionOrderId(order.id); setMessage(null);
    const result = await db.rpc("marketplace_submit_manual_momo_transaction", {
      p_payment_request_id: payment.payment_request_id,
      p_transaction_id: draft.transactionId,
    });
    setManualActionOrderId(null);
    if (result.error) { setMessage(result.error.message); return; }
    setManualPayments((current) => ({ ...current, [order.id]: { ...payment, status: "submitted" } }));
    setMessage(`BOAT has been alerted that you paid ${order.order_number}. Your transaction ID is awaiting verification.`);
  };

  const printOrderDocument = (order: MarketplaceOrder) => {
    const popup = window.open("", "_blank", "noopener,noreferrer,width=760,height=840");
    if (!popup) { setMessage("Allow pop-ups to print this order document."); return; }
    const isReceipt = ["paid", "fulfilled"].includes(order.status);
    const itemRows = (order.marketplace_order_items || []).map((item) => `<tr><td>${escapeHtml(`${item.quantity} × ${item.title}`)}</td><td class="amount">${escapeHtml(money(item.total_amount, order.currency))}</td></tr>`).join("");
    popup.document.write(`<!doctype html><html><head><title>${isReceipt ? "Receipt" : "Order"} ${escapeHtml(order.order_number)}</title><style>body{font-family:Arial,sans-serif;color:#0f172a;margin:0;padding:32px;background:#fff}.sheet{max-width:640px;margin:auto;border:1px solid #cbd5e1;padding:28px}.brand{display:flex;justify-content:space-between;align-items:start;border-bottom:2px solid #0f172a;padding-bottom:18px}.brand h1{margin:0;font-size:24px}.brand p{margin:5px 0 0;color:#475569}.label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#475569;margin-top:24px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px}.meta p{margin:0;font-size:14px}.meta strong{display:block;color:#475569;font-size:11px;text-transform:uppercase;margin-bottom:3px}table{width:100%;border-collapse:collapse;margin-top:22px}th,td{padding:10px 0;border-bottom:1px solid #e2e8f0;text-align:left;font-size:14px}th{font-size:11px;text-transform:uppercase;color:#475569}.amount{text-align:right}.total{display:flex;justify-content:space-between;font-size:18px;font-weight:700;margin-top:18px}.note{margin-top:24px;padding:12px;background:#f8fafc;color:#475569;font-size:12px}@media print{body{padding:0}.sheet{border:0}}</style></head><body><main class="sheet"><header class="brand"><div><h1>BOAT Market</h1><p>${isReceipt ? "Payment receipt" : "Order and payment instruction"}</p></div><strong>${isReceipt ? "RECEIPT" : "ORDER"}</strong></header><p class="label">Order details</p><div class="meta"><p><strong>Order number</strong>${escapeHtml(order.order_number)}</p><p><strong>Created</strong>${escapeHtml(new Date(order.created_at).toLocaleString())}</p><p><strong>Payment status</strong>${escapeHtml(order.status)}</p><p><strong>Payment reference</strong>${escapeHtml(order.payment_reference || "Not yet generated")}</p></div><table><thead><tr><th>Item</th><th class="amount">Amount</th></tr></thead><tbody>${itemRows}</tbody></table><div class="total"><span>Total</span><span>${escapeHtml(money(order.gross_amount, order.currency))}</span></div><p class="note">${isReceipt ? "Keep this receipt for your records." : "This order is not a payment receipt. Complete payment, then submit your Mobile Money transaction ID to BOAT for verification."}</p></main><script>window.onload=()=>window.print()<\/script></body></html>`);
    popup.document.close();
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
      <div className="mt-4 space-y-3">{orders.map((order) => {
        const manualPayment = manualPayments[order.id];
        const manualDraft = manualDraftFor(order.id);
        const canPay = !["paid", "fulfilled", "cancelled", "refunded"].includes(order.status);
        return <article key={order.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="font-semibold text-slate-900">{order.order_number}</h3><span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${statusClass(order.status)}`}>{order.status}</span></div><p className="mt-1 text-xs text-slate-500">{new Date(order.created_at).toLocaleString()}</p></div><div className="text-right"><p className="font-semibold text-slate-900">{money(order.gross_amount, order.currency)}</p>{order.payment_reference && <p className="mt-1 text-xs text-slate-500">Payment ref: {order.payment_reference}</p>}<button type="button" onClick={() => printOrderDocument(order)} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-indigo-700"><Printer className="h-4 w-4" /> {["paid", "fulfilled"].includes(order.status) ? "Print receipt" : "Print order"}</button></div></div>
          <ul className="mt-3 space-y-2 border-t border-slate-100 pt-3">{(order.marketplace_order_items || []).map((item) => { const review = reviewsByItem[item.id]; const draft = getDraft(item.id); return <li key={item.id} className="text-sm text-slate-700"><div className="flex flex-wrap items-start justify-between gap-2"><span>{item.quantity} × {item.title}</span><span>{money(item.total_amount, order.currency)}</span></div>{order.status === "fulfilled" && item.listing_id && <div className="mt-3 rounded-lg bg-slate-50 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium text-slate-800">{review ? "Update your review" : "Rate this item"}</p>{review && <span className="inline-flex items-center gap-1 text-amber-600"><Star className="h-4 w-4 fill-current" /> {review.rating}/5</span>}</div><div className="mt-2 grid gap-2 sm:grid-cols-[130px_1fr_auto]"><select value={draft.rating} onChange={(event) => updateDraft(item.id, { rating: Number(event.target.value) })} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">{[5, 4, 3, 2, 1].map((rating) => <option key={rating} value={rating}>{rating} star{rating === 1 ? "" : "s"}</option>)}</select><input value={draft.comment} onChange={(event) => updateDraft(item.id, { comment: event.target.value })} maxLength={500} placeholder="Share a short comment (optional)" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" /><button type="button" onClick={() => void submitReview(item.id)} disabled={submittingItemId === item.id} className="app-btn-secondary">{submittingItemId === item.id ? "Saving…" : "Save review"}</button></div></div>}</li>; })}</ul>
          {canPay && <section className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 p-4"><div className="flex items-start gap-2"><Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-indigo-700" /><div><h4 className="font-semibold text-slate-900">Paid using manual Mobile Money?</h4><p className="mt-1 text-sm text-slate-600">Enter the Mobile Money transaction ID after payment to alert BOAT for verification.</p></div></div>{!manualPayment ? <div className="mt-3 grid gap-2 sm:grid-cols-[180px_1fr_auto]"><select value={manualDraft.network} onChange={(event) => updateManualDraft(order.id, { network: event.target.value as "mtn" | "airtel" })} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><option value="mtn">Paying from MTN MoMo</option><option value="airtel">Paying from Airtel Money</option></select><input value={manualDraft.phone} onChange={(event) => updateManualDraft(order.id, { phone: event.target.value })} inputMode="tel" placeholder="Number used to pay" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /><button type="button" onClick={() => void showManualPaymentDetails(order)} disabled={manualActionOrderId === order.id} className="app-btn-primary">{manualActionOrderId === order.id ? "Loading…" : "Payment details"}</button></div> : <div className="mt-3 rounded-lg bg-white p-3 text-sm"><div className="grid gap-2 sm:grid-cols-2"><p><span className="font-medium">Pay to:</span> {manualPayment.recipient_name}</p><p><span className="font-medium">Receiving number:</span> {manualPayment.recipient_phone} ({manualPayment.recipient_network.toUpperCase()})</p><p><span className="font-medium">Amount:</span> {money(manualPayment.amount, manualPayment.currency)}</p><p><span className="font-medium">Reference:</span> <span className="font-mono">{manualPayment.payment_reference}</span></p></div>{manualPayment.payment_instructions && <p className="mt-3 rounded bg-slate-50 p-2 text-slate-700">{manualPayment.payment_instructions}</p>}{manualPayment.status === "submitted" ? <p className="mt-3 rounded bg-amber-50 p-2 font-medium text-amber-900">BOAT has been alerted. Your transaction ID is awaiting verification.</p> : <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]"><input value={manualDraft.transactionId} onChange={(event) => updateManualDraft(order.id, { transactionId: event.target.value })} placeholder="Mobile Money transaction ID" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><button type="button" onClick={() => void alertBoatOfManualPayment(order)} disabled={manualActionOrderId === order.id} className="app-btn-primary">{manualActionOrderId === order.id ? "Sending…" : "I have paid — alert BOAT"}</button></div>}</div>}</section>}
        </article>;
      })}{!loading && orders.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">You have not placed a marketplace order yet.</p>}</div>
    </div>
    <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-2"><Bell className="h-5 w-5 text-indigo-700" /><h2 className="font-semibold text-slate-900">Order updates</h2></div><div className="mt-3 space-y-3">{notifications.map((notification) => <article key={notification.id} className={`rounded-lg border p-3 ${notification.read_at ? "border-slate-200 bg-white" : "border-indigo-200 bg-indigo-50"}`}><div className="flex gap-2"><div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-900">{notification.title}</p><p className="mt-1 text-sm text-slate-600">{notification.body}</p><p className="mt-2 text-xs text-slate-500">{new Date(notification.created_at).toLocaleString()}</p></div>{!notification.read_at && <button type="button" onClick={() => void markRead(notification.id)} className="shrink-0 rounded p-1 text-indigo-700 hover:bg-indigo-100" aria-label="Mark update read"><Check className="h-4 w-4" /></button>}</div></article>)}{!loading && notifications.length === 0 && <p className="text-sm text-slate-500">Order and payment updates will appear here.</p>}</div></aside>
  </section>;
}
