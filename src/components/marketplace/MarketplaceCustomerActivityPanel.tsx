import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, Check, Printer, RefreshCw, Smartphone, Star, Upload, X } from "lucide-react";
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
  const [paymentDialogOrder, setPaymentDialogOrder] = useState<MarketplaceOrder | null>(null);
  const [paymentProofFile, setPaymentProofFile] = useState<File | null>(null);

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
    if (!payment || (!draft.transactionId.trim() && !paymentProofFile)) { setMessage("Enter the transaction ID, attach payment proof, or provide both."); return; }
    if (paymentProofFile && paymentProofFile.size > 10 * 1024 * 1024) { setMessage("Payment proof must be 10 MB or smaller."); return; }
    setManualActionOrderId(order.id); setMessage(null);
    let proofPath: string | null = null;
    if (paymentProofFile) {
      const safeName = paymentProofFile.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
      proofPath = `${user?.id}/${order.id}/${crypto.randomUUID()}-${safeName}`;
      const upload = await supabase.storage.from("marketplace-payment-proofs").upload(proofPath, paymentProofFile, { contentType: paymentProofFile.type || undefined });
      if (upload.error) { setManualActionOrderId(null); setMessage(upload.error.message); return; }
    }
    const result = await db.rpc("marketplace_submit_manual_momo_payment_alert", {
      p_payment_request_id: payment.payment_request_id,
      p_transaction_id: draft.transactionId.trim() || null,
      p_proof_path: proofPath,
      p_proof_name: paymentProofFile?.name || null,
    });
    setManualActionOrderId(null);
    if (result.error) { setMessage(result.error.message); return; }
    setManualPayments((current) => ({ ...current, [order.id]: { ...payment, status: "submitted" } }));
    setPaymentProofFile(null);
    setPaymentDialogOrder(null);
    setMessage(`BOAT has been alerted that you paid ${order.order_number}. Your payment evidence is awaiting verification.`);
  };

  const printOrderDocument = (order: MarketplaceOrder) => {
    // The document must be written into a same-origin window before printing. Some browsers
    // return a blank page when `noopener` is used together with document.write().
    const popup = window.open("", "_blank", "width=760,height=840");
    if (!popup) { setMessage("Allow pop-ups to print this order document."); return; }
    const isReceipt = ["paid", "fulfilled"].includes(order.status);
    const itemRows = (order.marketplace_order_items || []).map((item) => `<tr><td>${escapeHtml(`${item.quantity} × ${item.title}`)}</td><td class="amount">${escapeHtml(money(item.total_amount, order.currency))}</td></tr>`).join("");
    popup.document.open();
    popup.document.write(`<!doctype html><html><head><title>${isReceipt ? "Receipt" : "Order"} ${escapeHtml(order.order_number)}</title><style>html,body{background:#fff!important;color:#111827!important;color-scheme:light!important}body{font-family:Arial,sans-serif;margin:0;padding:32px}.sheet{max-width:640px;margin:auto;border:1px solid #cbd5e1;padding:28px;background:#fff}.brand{display:flex;justify-content:space-between;align-items:start;border-bottom:2px solid #0f172a;padding-bottom:18px}.brand h1{margin:0;font-size:24px}.brand p{margin:5px 0 0;color:#475569}.label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#475569;margin-top:24px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px}.meta p{margin:0;font-size:14px}.meta strong{display:block;color:#475569;font-size:11px;text-transform:uppercase;margin-bottom:3px}table{width:100%;border-collapse:collapse;margin-top:22px}th,td{padding:10px 0;border-bottom:1px solid #e2e8f0;text-align:left;font-size:14px}th{font-size:11px;text-transform:uppercase;color:#475569}.amount{text-align:right}.total{display:flex;justify-content:space-between;font-size:18px;font-weight:700;margin-top:18px}.note{margin-top:24px;padding:12px;background:#f8fafc;color:#475569;font-size:12px}@media print{html,body{background:#fff!important;color:#111827!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}body{padding:0}.sheet{border:0}}</style></head><body><main class="sheet"><header class="brand"><div><h1>BOAT Market</h1><p>${isReceipt ? "Payment receipt" : "Order and payment instruction"}</p></div><strong>${isReceipt ? "RECEIPT" : "ORDER"}</strong></header><p class="label">Order details</p><div class="meta"><p><strong>Order number</strong>${escapeHtml(order.order_number)}</p><p><strong>Created</strong>${escapeHtml(new Date(order.created_at).toLocaleString())}</p><p><strong>Payment status</strong>${escapeHtml(order.status)}</p><p><strong>Payment reference</strong>${escapeHtml(order.payment_reference || "Not yet generated")}</p></div><table><thead><tr><th>Item</th><th class="amount">Amount</th></tr></thead><tbody>${itemRows}</tbody></table><div class="total"><span>Total</span><span>${escapeHtml(money(order.gross_amount, order.currency))}</span></div><p class="note">${isReceipt ? "Keep this receipt for your records." : "This order is not a payment receipt. Complete payment, then submit your Mobile Money transaction ID to BOAT for verification."}</p></main></body></html>`);
    popup.document.close();
    popup.focus();
    window.setTimeout(() => popup.print(), 250);
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
        const canPay = !["paid", "fulfilled", "cancelled", "refunded"].includes(order.status);
        return <article key={order.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="font-semibold text-slate-900">{order.order_number}</h3><span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${statusClass(order.status)}`}>{order.status}</span></div><p className="mt-1 text-xs text-slate-500">{new Date(order.created_at).toLocaleString()}</p></div><div className="text-right"><p className="font-semibold text-slate-900">{money(order.gross_amount, order.currency)}</p>{order.payment_reference && <p className="mt-1 text-xs text-slate-500">Payment ref: {order.payment_reference}</p>}<button type="button" onClick={() => printOrderDocument(order)} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-indigo-700"><Printer className="h-4 w-4" /> {["paid", "fulfilled"].includes(order.status) ? "Print receipt" : "Print order"}</button></div></div>
          <ul className="mt-3 space-y-2 border-t border-slate-100 pt-3">{(order.marketplace_order_items || []).map((item) => { const review = reviewsByItem[item.id]; const draft = getDraft(item.id); return <li key={item.id} className="text-sm text-slate-700"><div className="flex flex-wrap items-start justify-between gap-2"><span>{item.quantity} × {item.title}</span><span>{money(item.total_amount, order.currency)}</span></div>{order.status === "fulfilled" && item.listing_id && <div className="mt-3 rounded-lg bg-slate-50 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium text-slate-800">{review ? "Update your review" : "Rate this item"}</p>{review && <span className="inline-flex items-center gap-1 text-amber-600"><Star className="h-4 w-4 fill-current" /> {review.rating}/5</span>}</div><div className="mt-2 grid gap-2 sm:grid-cols-[130px_1fr_auto]"><select value={draft.rating} onChange={(event) => updateDraft(item.id, { rating: Number(event.target.value) })} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">{[5, 4, 3, 2, 1].map((rating) => <option key={rating} value={rating}>{rating} star{rating === 1 ? "" : "s"}</option>)}</select><input value={draft.comment} onChange={(event) => updateDraft(item.id, { comment: event.target.value })} maxLength={500} placeholder="Share a short comment (optional)" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" /><button type="button" onClick={() => void submitReview(item.id)} disabled={submittingItemId === item.id} className="app-btn-secondary">{submittingItemId === item.id ? "Saving…" : "Save review"}</button></div></div>}</li>; })}</ul>
          {canPay && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-indigo-200 bg-indigo-50 p-4"><div className="flex items-start gap-2"><Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-indigo-700" /><div><h4 className="font-semibold text-slate-900">Paid using manual Mobile Money?</h4><p className="mt-1 text-sm text-slate-600">Tell BOAT you have paid using a transaction ID, payment proof, or both.</p></div></div><button type="button" onClick={() => { setPaymentProofFile(null); setPaymentDialogOrder(order); }} className="app-btn-primary">Mark as paid</button></div>}
        </article>;
      })}{!loading && orders.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">You have not placed a marketplace order yet.</p>}</div>
      {paymentDialogOrder && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="marketplace-payment-alert-title"><div className="w-full max-w-xl rounded-xl bg-white p-5 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Manual Mobile Money</p><h2 id="marketplace-payment-alert-title" className="mt-1 text-lg font-semibold text-slate-900">Mark {paymentDialogOrder.order_number} as paid</h2><p className="mt-1 text-sm text-slate-600">BOAT will verify the payment before marking this order paid.</p></div><button type="button" onClick={() => { setPaymentProofFile(null); setPaymentDialogOrder(null); }} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close payment alert"><X className="h-5 w-5" /></button></div>{message && <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">{message}</p>}{!manualPayments[paymentDialogOrder.id] ? <div className="mt-5 space-y-3"><p className="text-sm text-slate-700">First confirm the phone number and network used for the payment.</p><div className="grid gap-3 sm:grid-cols-[180px_1fr]"><select value={manualDraftFor(paymentDialogOrder.id).network} onChange={(event) => updateManualDraft(paymentDialogOrder.id, { network: event.target.value as "mtn" | "airtel" })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="mtn">MTN Mobile Money</option><option value="airtel">Airtel Money</option></select><input value={manualDraftFor(paymentDialogOrder.id).phone} onChange={(event) => updateManualDraft(paymentDialogOrder.id, { phone: event.target.value })} inputMode="tel" placeholder="Number used to pay" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /></div><div className="mt-5 flex justify-end gap-3"><button type="button" onClick={() => { setPaymentProofFile(null); setPaymentDialogOrder(null); }} className="app-btn-secondary">Cancel</button><button type="button" onClick={() => void showManualPaymentDetails(paymentDialogOrder)} disabled={manualActionOrderId === paymentDialogOrder.id} className="app-btn-primary">{manualActionOrderId === paymentDialogOrder.id ? "Loading…" : "Continue"}</button></div></div> : manualPayments[paymentDialogOrder.id].status === "submitted" ? <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p className="font-semibold">BOAT has already been alerted.</p><p className="mt-1">The payment evidence for this order is awaiting verification.</p><button type="button" onClick={() => setPaymentDialogOrder(null)} className="app-btn-secondary mt-4">Close</button></div> : <div className="mt-5 space-y-4"><div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-slate-700"><div className="grid gap-2 sm:grid-cols-2"><p><span className="font-medium">Pay to:</span> {manualPayments[paymentDialogOrder.id].recipient_name}</p><p><span className="font-medium">Receiving number:</span> {manualPayments[paymentDialogOrder.id].recipient_phone} ({manualPayments[paymentDialogOrder.id].recipient_network.toUpperCase()})</p><p><span className="font-medium">Amount:</span> {money(manualPayments[paymentDialogOrder.id].amount, manualPayments[paymentDialogOrder.id].currency)}</p><p><span className="font-medium">Reference:</span> <span className="font-mono">{manualPayments[paymentDialogOrder.id].payment_reference}</span></p></div>{manualPayments[paymentDialogOrder.id].payment_instructions && <p className="mt-3 rounded bg-white p-2">{manualPayments[paymentDialogOrder.id].payment_instructions}</p>}</div><div><label className="text-sm font-medium text-slate-800">Mobile Money transaction ID <span className="font-normal text-slate-500">(optional if proof is attached)</span></label><input value={manualDraftFor(paymentDialogOrder.id).transactionId} onChange={(event) => updateManualDraft(paymentDialogOrder.id, { transactionId: event.target.value })} placeholder="For example: 123ABC456" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></div><div><label className="text-sm font-medium text-slate-800">Payment proof <span className="font-normal text-slate-500">(optional if transaction ID is entered)</span></label><label className="mt-1 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-600"><span className="flex min-w-0 items-center gap-2"><Upload className="h-4 w-4 shrink-0" /><span className="truncate">{paymentProofFile ? paymentProofFile.name : "Attach screenshot, image, or PDF (max 10 MB)"}</span></span><span className="font-medium text-indigo-700">Choose file</span><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => setPaymentProofFile(event.target.files?.[0] || null)} /></label></div><p className="text-xs text-slate-500">Provide at least one: a transaction ID or payment proof. Providing both makes verification easier.</p><div className="flex justify-end gap-3"><button type="button" onClick={() => { setPaymentProofFile(null); setPaymentDialogOrder(null); }} className="app-btn-secondary">Cancel</button><button type="button" onClick={() => void alertBoatOfManualPayment(paymentDialogOrder)} disabled={manualActionOrderId === paymentDialogOrder.id} className="app-btn-primary">{manualActionOrderId === paymentDialogOrder.id ? "Sending…" : "Alert BOAT"}</button></div></div>}</div></div>}
    </div>
    <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-2"><Bell className="h-5 w-5 text-indigo-700" /><h2 className="font-semibold text-slate-900">Order updates</h2></div><div className="mt-3 space-y-3">{notifications.map((notification) => <article key={notification.id} className={`rounded-lg border p-3 ${notification.read_at ? "border-slate-200 bg-white" : "border-indigo-200 bg-indigo-50"}`}><div className="flex gap-2"><div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-900">{notification.title}</p><p className="mt-1 text-sm text-slate-600">{notification.body}</p><p className="mt-2 text-xs text-slate-500">{new Date(notification.created_at).toLocaleString()}</p></div>{!notification.read_at && <button type="button" onClick={() => void markRead(notification.id)} className="shrink-0 rounded p-1 text-indigo-700 hover:bg-indigo-100" aria-label="Mark update read"><Check className="h-4 w-4" /></button>}</div></article>)}{!loading && notifications.length === 0 && <p className="text-sm text-slate-500">Order and payment updates will appear here.</p>}</div></aside>
  </section>;
}
