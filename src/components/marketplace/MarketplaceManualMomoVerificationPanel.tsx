import { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, RefreshCw, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";

const db = supabase as any;

type Customer = { full_name: string; phone: string | null };
type Order = { order_number: string; gross_amount: number; currency: string; merchant_id: string; marketplace_customers: Customer | Customer[] | null };
type Submission = {
  id: string;
  payment_reference: string;
  manual_transaction_id: string | null;
  payment_proof_path: string | null;
  payment_proof_name: string | null;
  network: string;
  phone_number: string;
  amount: number;
  currency: string;
  submitted_at: string | null;
  marketplace_orders: Order | Order[] | null;
};

const money = (amount: number, currency: string) => `${currency} ${Number(amount || 0).toLocaleString()}`;

export function MarketplaceManualMomoVerificationPanel({ merchantId, organizationId }: { merchantId: string; organizationId: string }) {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [openingProofId, setOpeningProofId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await db.from("marketplace_payment_requests")
      .select("id,payment_reference,manual_transaction_id,payment_proof_path,payment_proof_name,network,phone_number,amount,currency,submitted_at,marketplace_orders!inner(order_number,gross_amount,currency,merchant_id,marketplace_customers(full_name,phone))")
      .eq("organization_id", organizationId)
      .eq("provider", "manual_momo")
      .eq("status", "submitted")
      .eq("marketplace_orders.merchant_id", merchantId)
      .order("submitted_at", { ascending: true });
    setLoading(false);
    if (result.error) {
      setMessage(result.error.message);
      return;
    }
    setSubmissions((result.data || []) as Submission[]);
  }, [merchantId, organizationId]);

  useEffect(() => { void load(); }, [load]);

  const verify = async (submission: Submission, approved: boolean) => {
    const note = notes[submission.id] || "";
    if (!approved && !note.trim()) {
      setMessage("Add a reason before rejecting a submitted transaction ID.");
      return;
    }
    setBusyId(submission.id);
    setMessage(null);
    const result = await db.rpc("marketplace_verify_manual_momo_payment", {
      p_payment_request_id: submission.id,
      p_approved: approved,
      p_note: note || null,
    });
    setBusyId(null);
    if (result.error) {
      setMessage(result.error.message);
      return;
    }
    setMessage(approved ? "Payment verified. The order is now paid and its commission has been recorded." : "Payment submission rejected and the customer has been notified.");
    await load();
  };

  const openPaymentProof = async (submission: Submission) => {
    if (!submission.payment_proof_path) return;
    setOpeningProofId(submission.id); setMessage(null);
    const result = await supabase.storage.from("marketplace-payment-proofs").createSignedUrl(submission.payment_proof_path, 300);
    setOpeningProofId(null);
    if (result.error || !result.data?.signedUrl) { setMessage(result.error?.message || "Could not open the payment proof."); return; }
    window.open(result.data.signedUrl, "_blank", "noopener,noreferrer");
  };

  return <section className="mt-6 border-t border-indigo-200 pt-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold text-slate-900">Manual MoMo verification</h3><p className="mt-1 text-sm text-slate-600">Verify the provider transaction in your MoMo statement before approving it. Approval marks the order paid and records the marketplace commission.</p></div><button type="button" onClick={() => void load()} disabled={loading} className="app-btn-secondary"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button></div>
    {message && <p className="mt-3 text-sm text-slate-700" role="status">{message}</p>}
    <div className="mt-4 space-y-3">{submissions.map((submission) => {
      const order = Array.isArray(submission.marketplace_orders) ? submission.marketplace_orders[0] : submission.marketplace_orders;
      const customer = order ? (Array.isArray(order.marketplace_customers) ? order.marketplace_customers[0] : order.marketplace_customers) : null;
      const busy = busyId === submission.id;
       return <article key={submission.id} className="rounded-lg border border-amber-200 bg-amber-50/50 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold text-slate-900">{order?.order_number || "Marketplace order"}</p><p className="mt-1 text-sm text-slate-700">Transaction ID: {submission.manual_transaction_id ? <span className="font-mono font-semibold">{submission.manual_transaction_id}</span> : <span className="text-slate-500">Not provided</span>}</p><p className="mt-1 text-xs text-slate-600">Payment ref: {submission.payment_reference} · Submitted {submission.submitted_at ? new Date(submission.submitted_at).toLocaleString() : "just now"}</p></div><p className="font-semibold text-slate-900">{money(submission.amount, submission.currency)}</p></div><p className="mt-3 text-sm text-slate-700">Customer: {customer?.full_name || "Marketplace customer"}{customer?.phone ? ` · ${customer.phone}` : ""} · Paying from {submission.network.toUpperCase()} {submission.phone_number}</p>{submission.payment_proof_path && <button type="button" onClick={() => void openPaymentProof(submission)} disabled={openingProofId === submission.id} className="app-btn-secondary mt-3">{openingProofId === submission.id ? "Opening…" : <><ExternalLink className="h-4 w-4" /> {submission.payment_proof_name || "View payment proof"}</>}</button>}<textarea value={notes[submission.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [submission.id]: event.target.value }))} placeholder="Verification note (required if rejecting)" className="mt-3 min-h-16 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void verify(submission, true)} className="app-btn-primary"><Check className="h-4 w-4" /> Verify payment</button><button type="button" disabled={busy} onClick={() => void verify(submission, false)} className="app-btn-secondary text-rose-700"><XCircle className="h-4 w-4" /> Reject submission</button></div></article>;
    })}{!loading && submissions.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">No manual MoMo payments are waiting for verification.</p>}</div>
  </section>;
}
