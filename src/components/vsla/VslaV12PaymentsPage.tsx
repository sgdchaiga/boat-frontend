import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Link2, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";

type PaymentIntent = { id: string; purpose: string; loan_id: string | null; shareout_id: string | null; provider: string; channel: string; provider_reference: string; amount: number; currency: string; status: string; settlement_event_id: string | null; settled_at: string | null; reversal_event_id: string | null; created_at: string };
type PaymentEvent = { id: string; provider: string; provider_reference: string; provider_transaction_id: string | null; channel: string; direction: "incoming" | "outgoing"; amount: number; currency: string; status: string; received_at: string; failure_reason: string | null; payment_intent_id: string | null };
type Meeting = { id: string; meeting_date: string };
type Member = { id: string; full_name: string; member_number: string | null };
type Loan = { id: string; member_id: string; principal_amount: number; outstanding_balance: number; status: string };
type Shareout = { id: string; payout_schedule: Array<{ member_id: string; payout_amount: number }> };

const expectedDirection = (purpose: string) => ["loan_disbursement", "expense", "shareout_payout"].includes(purpose) ? "outgoing" : "incoming";

export function VslaV12PaymentsPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user, isSuperAdmin } = useAuth();
  const orgId = user?.organization_id ?? null;
  const [intents, setIntents] = useState<PaymentIntent[]>([]);
  const [events, setEvents] = useState<PaymentEvent[]>([]);
  const [selectedIntent, setSelectedIntent] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [workflowLoaded, setWorkflowLoaded] = useState(false);
  const [v12, setV12] = useState(false);
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [shareouts, setShareouts] = useState<Shareout[]>([]);
  const [collectionPurpose, setCollectionPurpose] = useState<"savings" | "loan_repayment">("savings");
  const [collectionMeetingId, setCollectionMeetingId] = useState("");
  const [collectionMemberId, setCollectionMemberId] = useState("");
  const [collectionLoanId, setCollectionLoanId] = useState("");
  const [collectionAmount, setCollectionAmount] = useState("");
  const [promptPhones, setPromptPhones] = useState<Record<string, string>>({});
  const [promptNetworks, setPromptNetworks] = useState<Record<string, "mtn" | "airtel">>({});

  useEffect(() => { let live = true; void (async () => {
    if (!orgId) { if (live) setWorkflowLoaded(true); return; }
    const { data } = await (supabase as any).from("vsla_workflow_settings").select("workflow_version").eq("organization_id", orgId).maybeSingle();
    if (live) { setV12(data?.workflow_version === "v1_2"); setWorkflowLoaded(true); }
  })(); return () => { live = false; }; }, [orgId]);

  useEffect(() => { let live = true; void (async () => {
    const { data } = await (supabase as any).from("boat_pay_provider_connections").select("provider_code,enabled,module_codes").eq("enabled", true).contains("module_codes", ["vsla"]).maybeSingle();
    if (live) setActiveProvider(data?.provider_code ?? null);
  })(); return () => { live = false; }; }, []);

  const load = useCallback(async () => {
    const [intentResult, eventResult, meetingResult, memberResult, loanResult, shareoutResult] = await Promise.all([
      filterByOrganizationId((supabase as any).from("boat_pay_payment_intents").select("id,purpose,loan_id,shareout_id,provider,channel,provider_reference,amount,currency,status,settlement_event_id,settled_at,reversal_event_id,created_at").eq("module_code", "vsla").order("created_at", { ascending: false }).limit(100), orgId, !!isSuperAdmin),
      filterByOrganizationId((supabase as any).from("boat_pay_payment_events").select("id,provider,provider_reference,provider_transaction_id,channel,direction,amount,currency,status,received_at,failure_reason,payment_intent_id").eq("module_code", "vsla").order("received_at", { ascending: false }).limit(100), orgId, !!isSuperAdmin),
      filterByOrganizationId(supabase.from("vsla_meetings").select("id,meeting_date").eq("status", "open").order("meeting_date", { ascending: false }).limit(25), orgId, !!isSuperAdmin),
      filterByOrganizationId(supabase.from("vsla_members").select("id,full_name,member_number").eq("status", "active").order("full_name").limit(500), orgId, !!isSuperAdmin),
      filterByOrganizationId((supabase as any).from("vsla_v12_loans").select("id,member_id,principal_amount,outstanding_balance,status").in("status", ["disbursed", "approved_pending_payout"]).order("created_at", { ascending: false }).limit(100), orgId, !!isSuperAdmin),
      filterByOrganizationId((supabase as any).from("vsla_v12_shareouts").select("id,payout_schedule").eq("status", "approved").order("approved_at", { ascending: false }).limit(10), orgId, !!isSuperAdmin),
    ]);
    setIntents((intentResult.data ?? []) as PaymentIntent[]);
    setEvents((eventResult.data ?? []) as PaymentEvent[]);
    setMeetings((meetingResult.data ?? []) as Meeting[]);
    setMembers((memberResult.data ?? []) as Member[]);
    setLoans((loanResult.data ?? []) as Loan[]);
    setShareouts((shareoutResult.data ?? []) as Shareout[]);
    setError(intentResult.error?.message ?? eventResult.error?.message ?? meetingResult.error?.message ?? memberResult.error?.message ?? loanResult.error?.message ?? shareoutResult.error?.message ?? null);
  }, [isSuperAdmin, orgId]);

  useEffect(() => { void load(); }, [load]);

  const unmatchedEvents = useMemo(() => events.filter((event) => ["received", "verified", "unmatched"].includes(event.status)), [events]);
  const matchedReceipts = useMemo(() => intents.filter((intent) => intent.status === "matched" && ["savings", "loan_repayment"].includes(intent.purpose)), [intents]);
  const reversalPending = useMemo(() => intents.filter((intent) => intent.status === "reversal_pending" && !!intent.settlement_event_id), [intents]);
  const settledCount = useMemo(() => intents.filter((intent) => intent.status === "settled").length, [intents]);
  const promptReady = useMemo(() => intents.filter((intent) => intent.provider === "flutterwave" && intent.channel === "mobile_money" && ["savings", "loan_repayment"].includes(intent.purpose) && intent.status === "created"), [intents]);
  const approvedLoanPayouts = useMemo(() => loans.filter((loan) => loan.status === "approved_pending_payout" && !intents.some((intent) => intent.purpose === "loan_disbursement" && intent.loan_id === loan.id && !["failed", "reversed", "refunded", "cancelled"].includes(intent.status))), [intents, loans]);
  const payoutReady = useMemo(() => intents.filter((intent) => intent.provider === "flutterwave" && intent.channel === "mobile_money" && ["loan_disbursement", "shareout_payout"].includes(intent.purpose) && intent.status === "created"), [intents]);
  const matchedPayouts = useMemo(() => intents.filter((intent) => ["loan_disbursement", "shareout_payout"].includes(intent.purpose) && intent.status === "matched"), [intents]);
  const memberName = useMemo(() => new Map(members.map((member) => [member.id, member.full_name])), [members]);
  const availableIntents = useCallback((event: PaymentEvent) => intents.filter((intent) => ["created", "provider_pending", "provider_confirmed"].includes(intent.status) && Number(intent.amount) === Number(event.amount) && intent.currency === event.currency && expectedDirection(intent.purpose) === event.direction), [intents]);

  const match = async (eventId: string) => {
    const intentId = selectedIntent[eventId];
    if (!intentId) { setError("Select a matching payment request first."); return; }
    setBusy(eventId); setError(null); setMessage(null);
    const { error: matchError } = await supabase.rpc("vsla_v12_match_boat_pay_event", { p_event_id: eventId, p_intent_id: intentId, p_note: notes[eventId] || null });
    if (matchError) setError(matchError.message); else { setMessage("Payment evidence matched. It remains subject to the controlled settlement workflow; no ledger entry was posted by matching."); await load(); }
    setBusy(null);
  };

  const settle = async (intentId: string) => {
    setBusy(`settle:${intentId}`); setError(null); setMessage(null);
    const { error: settleError } = await supabase.rpc("vsla_v12_settle_boat_pay_receipt", { p_intent_id: intentId, p_note: null });
    if (settleError) setError(settleError.message); else { setMessage("Receipt settled to the controlled VSLA ledger. The provider evidence and ledger event remain linked for audit."); await load(); }
    setBusy(null);
  };

  const resolveReversal = async (intentId: string) => {
    const reason = notes[`reversal:${intentId}`]?.trim();
    if (!reason) { setError("Enter a reason for the provider reversal resolution."); return; }
    setBusy(`reversal:${intentId}`); setError(null); setMessage(null);
    const { error: reversalError } = await supabase.rpc("vsla_v12_resolve_boat_pay_receipt_reversal", { p_intent_id: intentId, p_reason: reason });
    if (reversalError) setError(reversalError.message); else { setMessage("The original receipt was reversed through the controlled VSLA reversal trail."); await load(); }
    setBusy(null);
  };

  const createCollectionRequest = async () => {
    const amount = Number(collectionAmount);
    const loan = loans.find((item) => item.id === collectionLoanId);
    const memberId = collectionPurpose === "loan_repayment" ? loan?.member_id ?? null : collectionMemberId || null;
    if (!collectionMeetingId || !memberId || !Number.isFinite(amount) || amount <= 0 || (collectionPurpose === "loan_repayment" && !loan)) { setError("Select the controlled meeting and member or loan, then enter a valid amount."); return; }
    setBusy("create-collection"); setError(null); setMessage(null);
    const { error: createError } = await supabase.rpc("vsla_v12_create_boat_pay_intent", { p_purpose: collectionPurpose, p_amount: amount, p_provider: "flutterwave", p_channel: "mobile_money", p_member_id: memberId, p_meeting_id: collectionMeetingId, p_loan_id: collectionPurpose === "loan_repayment" ? collectionLoanId : null, p_shareout_id: null, p_idempotency_key: crypto.randomUUID(), p_metadata: {} });
    if (createError) setError(createError.message); else { setMessage("Mobile-money collection request created. Enter the member phone number below to send its single provider prompt."); setCollectionAmount(""); await load(); }
    setBusy(null);
  };

  const sendPrompt = async (intentId: string) => {
    const phone = promptPhones[intentId]?.trim();
    if (!phone) { setError("Enter the member mobile-money number before sending a prompt."); return; }
    setBusy(`prompt:${intentId}`); setError(null); setMessage(null);
    const { data, error: invokeError } = await supabase.functions.invoke("boat-pay-flutterwave-collection", { body: { intent_id: intentId, phone_number: phone, network: promptNetworks[intentId] ?? "mtn" } });
    if (invokeError || data?.ok === false) setError(invokeError?.message ?? data?.error ?? "Unable to send the mobile-money prompt."); else { setMessage("Provider prompt sent. Wait for verified provider evidence, then match and settle it through the controls above."); await load(); }
    setBusy(null);
  };

  const createLoanPayout = async (loanId: string) => {
    setBusy(`create-payout:${loanId}`); setError(null); setMessage(null);
    const { error: createError } = await supabase.rpc("vsla_v12_create_digital_loan_payout_intent", { p_loan_id: loanId, p_provider: "flutterwave", p_idempotency_key: crypto.randomUUID() });
    if (createError) setError(createError.message); else { setMessage("Digital loan payout request created. Enter the recipient mobile-money number below to send its single provider instruction."); await load(); }
    setBusy(null);
  };

  const createShareoutPayout = async (shareoutId: string, memberId: string) => {
    setBusy(`create-shareout:${shareoutId}:${memberId}`); setError(null); setMessage(null);
    const { error: createError } = await supabase.rpc("vsla_v12_create_shareout_payout_intent", { p_shareout_id: shareoutId, p_member_id: memberId, p_provider: "flutterwave", p_idempotency_key: crypto.randomUUID() });
    if (createError) setError(createError.message); else { setMessage("Share-out payout request created. Enter the recipient mobile-money number below to send its single provider instruction."); await load(); }
    setBusy(null);
  };

  const sendLoanPayout = async (intentId: string) => {
    const phone = promptPhones[intentId]?.trim();
    if (!phone) { setError("Enter the recipient mobile-money number before sending a payout."); return; }
    setBusy(`payout:${intentId}`); setError(null); setMessage(null);
    const { data, error: invokeError } = await supabase.functions.invoke("boat-pay-flutterwave-loan-payout", { body: { intent_id: intentId, phone_number: phone, network: promptNetworks[intentId] ?? "mtn" } });
    if (invokeError || data?.ok === false) setError(invokeError?.message ?? data?.error ?? "Unable to send the loan payout."); else { setMessage("Payout instruction sent. Wait for provider evidence, then independently match and finalize the loan disbursement."); await load(); }
    setBusy(null);
  };

  const finalizeLoanPayout = async (intentId: string) => {
    setBusy(`finalize-payout:${intentId}`); setError(null); setMessage(null);
    const { error: finalizeError } = await supabase.rpc("vsla_v12_finalize_digital_loan_disbursement", { p_intent_id: intentId, p_note: null });
    if (finalizeError) setError(finalizeError.message); else { setMessage("Provider payout confirmed and the controlled loan disbursement has been posted."); await load(); }
    setBusy(null);
  };

  const finalizeShareoutPayout = async (intentId: string) => {
    setBusy(`finalize-shareout:${intentId}`); setError(null); setMessage(null);
    const { error: finalizeError } = await supabase.rpc("vsla_v12_finalize_shareout_payout", { p_intent_id: intentId, p_note: null });
    if (finalizeError) setError(finalizeError.message); else { setMessage("Provider payout confirmed and the controlled share-out payment has been posted."); await load(); }
    setBusy(null);
  };

  if (!workflowLoaded) return <div className="p-6 text-sm text-slate-600">Loading payment workflow…</div>;
  if (!v12) return <div className="mx-auto max-w-2xl p-6 lg:p-8"><div className="rounded-xl border border-indigo-200 bg-indigo-50 p-6 text-center"><h1 className="text-xl font-bold text-slate-900">Digital payments use the v1.2 controlled workflow</h1><p className="mt-2 text-sm text-slate-700">A Super Admin must switch this VSLA group to v1.2 before BOAT Pay payment evidence can be reviewed.</p></div></div>;

  return <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
    {readOnly && <ReadOnlyNotice />}
    <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-5"><p className="text-xs font-bold uppercase tracking-wider text-indigo-700">VSLA v1.2 · BOAT Pay</p><h1 className="mt-1 text-2xl font-bold text-slate-900">Digital payment inbox</h1><p className="mt-1 text-sm text-slate-700">Review trusted provider evidence and match it to a VSLA payment request. Matching does not by itself post a financial transaction.</p></div>
    {activeProvider ? <div className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0"/><p>{activeProvider} is enabled for BOAT Pay provider notifications. Provider evidence still requires controlled matching and settlement; payment sending remains restricted to a separately deployed provider workflow.</p></div> : <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0"/><p>No VSLA payment provider has been activated in this release. This inbox is ready for a licensed, configured BOAT Pay provider; no collection, disbursement, or payout can be sent from this screen yet.</p></div>}
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    {message && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
    <section aria-label="Payment reconciliation summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
      ["Provider evidence to match", unmatchedEvents.length, "text-amber-800 bg-amber-50 border-amber-200"],
      ["Receipts awaiting settlement", matchedReceipts.length, "text-indigo-800 bg-indigo-50 border-indigo-200"],
      ["Provider reversal exceptions", reversalPending.length, "text-rose-800 bg-rose-50 border-rose-200"],
      ["Settled receipts", settledCount, "text-emerald-800 bg-emerald-50 border-emerald-200"],
    ].map(([label, value, tone]) => <div key={String(label)} className={`rounded-xl border p-4 ${tone}`}><p className="text-xs font-semibold uppercase tracking-wide">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p></div>)}</section>
    {activeProvider === "flutterwave" && <section className="rounded-xl border border-indigo-200 bg-white p-5"><div><h2 className="font-semibold text-slate-900">Create mobile-money collection request</h2><p className="mt-1 text-sm text-slate-600">Create a controlled savings or loan-repayment request first. Member phone numbers are supplied only when sending the provider prompt and are not stored here.</p></div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="text-sm text-slate-700">Purpose<select value={collectionPurpose} onChange={(event) => setCollectionPurpose(event.target.value as "savings" | "loan_repayment")} disabled={readOnly} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"><option value="savings">Savings</option><option value="loan_repayment">Loan repayment</option></select></label><label className="text-sm text-slate-700">Open meeting<select value={collectionMeetingId} onChange={(event) => setCollectionMeetingId(event.target.value)} disabled={readOnly} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"><option value="">Select meeting</option>{meetings.map((meeting) => <option key={meeting.id} value={meeting.id}>{meeting.meeting_date}</option>)}</select></label>{collectionPurpose === "savings" ? <label className="text-sm text-slate-700 lg:col-span-2">Member<select value={collectionMemberId} onChange={(event) => setCollectionMemberId(event.target.value)} disabled={readOnly} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"><option value="">Select member</option>{members.map((member) => <option key={member.id} value={member.id}>{member.full_name}{member.member_number ? ` (${member.member_number})` : ""}</option>)}</select></label> : <label className="text-sm text-slate-700 lg:col-span-2">Loan<select value={collectionLoanId} onChange={(event) => setCollectionLoanId(event.target.value)} disabled={readOnly} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"><option value="">Select active loan</option>{loans.map((loan) => <option key={loan.id} value={loan.id}>{memberName.get(loan.member_id) ?? "Member"} · balance {Number(loan.outstanding_balance).toLocaleString()}</option>)}</select></label>}<label className="text-sm text-slate-700">Amount<input type="number" min="1" value={collectionAmount} onChange={(event) => setCollectionAmount(event.target.value)} disabled={readOnly} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"/></label></div><button type="button" onClick={() => void createCollectionRequest()} disabled={readOnly || busy === "create-collection"} className="mt-4 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy === "create-collection" ? "Creating…" : "Create collection request"}</button><div className="mt-5 space-y-3">{promptReady.map((intent) => <div key={intent.id} className="grid gap-2 rounded-xl border border-indigo-200 bg-indigo-50 p-4 sm:grid-cols-[1fr_10rem_9rem_auto]"><div><p className="font-semibold text-slate-900">{intent.purpose.replace(/_/g, " ")} · {intent.provider_reference}</p><p className="text-sm text-slate-600">{Number(intent.amount).toLocaleString()} {intent.currency}</p></div><input aria-label={`Mobile number for ${intent.provider_reference}`} value={promptPhones[intent.id] ?? ""} onChange={(event) => setPromptPhones((current) => ({ ...current, [intent.id]: event.target.value }))} placeholder="Mobile number" disabled={readOnly} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"/><select aria-label={`Network for ${intent.provider_reference}`} value={promptNetworks[intent.id] ?? "mtn"} onChange={(event) => setPromptNetworks((current) => ({ ...current, [intent.id]: event.target.value as "mtn" | "airtel" }))} disabled={readOnly} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="mtn">MTN</option><option value="airtel">Airtel</option></select><button type="button" onClick={() => void sendPrompt(intent.id)} disabled={readOnly || busy === `prompt:${intent.id}`} className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy === `prompt:${intent.id}` ? "Sending…" : "Send prompt"}</button></div>)}{promptReady.length === 0 && <p className="text-sm text-slate-500">No created collection requests are awaiting a mobile-money prompt.</p>}</div></section>}
    {activeProvider === "flutterwave" && <section className="rounded-xl border border-violet-200 bg-white p-5"><div><h2 className="font-semibold text-slate-900">Approved digital payouts</h2><p className="mt-1 text-sm text-slate-600">Loans and share-out entitlements remain pending until the provider payout is independently matched and finalized.</p></div><div className="mt-4 space-y-3">{approvedLoanPayouts.map((loan) => <div key={loan.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-200 p-4"><div><p className="font-semibold text-slate-900">{memberName.get(loan.member_id) ?? "Member"}</p><p className="text-sm text-slate-600">Approved loan principal: {Number(loan.principal_amount).toLocaleString()}</p></div><button type="button" onClick={() => void createLoanPayout(loan.id)} disabled={readOnly || busy === `create-payout:${loan.id}`} className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy === `create-payout:${loan.id}` ? "Creating…" : "Create loan payout"}</button></div>)}{shareouts.flatMap((shareout) => shareout.payout_schedule.filter((item) => !intents.some((intent) => intent.purpose === "shareout_payout" && intent.shareout_id === shareout.id && !["failed", "reversed", "refunded", "cancelled"].includes(intent.status) && intent.loan_id === null && Number(intent.amount) === Number(item.payout_amount))).map((item) => <div key={`${shareout.id}:${item.member_id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-200 p-4"><div><p className="font-semibold text-slate-900">{memberName.get(item.member_id) ?? "Member"}</p><p className="text-sm text-slate-600">Approved share-out: {Number(item.payout_amount).toLocaleString()}</p></div><button type="button" onClick={() => void createShareoutPayout(shareout.id, item.member_id)} disabled={readOnly || busy === `create-shareout:${shareout.id}:${item.member_id}`} className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy === `create-shareout:${shareout.id}:${item.member_id}` ? "Creating…" : "Create share-out payout"}</button></div>))}{approvedLoanPayouts.length === 0 && shareouts.length === 0 && <p className="text-sm text-slate-500">No approved digital payouts are awaiting a provider request.</p>}{payoutReady.map((intent) => <div key={intent.id} className="grid gap-2 rounded-xl border border-violet-200 bg-violet-50 p-4 sm:grid-cols-[1fr_10rem_9rem_auto]"><div><p className="font-semibold text-slate-900">{intent.purpose === "loan_disbursement" ? "Loan payout" : "Share-out payout"} · {intent.provider_reference}</p><p className="text-sm text-slate-600">{Number(intent.amount).toLocaleString()} {intent.currency}</p></div><input aria-label={`Payout mobile number for ${intent.provider_reference}`} value={promptPhones[intent.id] ?? ""} onChange={(event) => setPromptPhones((current) => ({ ...current, [intent.id]: event.target.value }))} placeholder="Recipient number" disabled={readOnly} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"/><select aria-label={`Payout network for ${intent.provider_reference}`} value={promptNetworks[intent.id] ?? "mtn"} onChange={(event) => setPromptNetworks((current) => ({ ...current, [intent.id]: event.target.value as "mtn" | "airtel" }))} disabled={readOnly} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="mtn">MTN</option><option value="airtel">Airtel</option></select><button type="button" onClick={() => void sendLoanPayout(intent.id)} disabled={readOnly || busy === `payout:${intent.id}`} className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy === `payout:${intent.id}` ? "Sending…" : "Send payout"}</button></div>)}{matchedPayouts.map((intent) => <div key={`finalize-${intent.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4"><div><p className="font-semibold text-slate-900">Matched {intent.purpose === "loan_disbursement" ? "loan" : "share-out"} payout · {intent.provider_reference}</p><p className="text-sm text-slate-600">Provider evidence is matched. A different authorized user must finalize the ledger payment.</p></div><button type="button" onClick={() => void (intent.purpose === "loan_disbursement" ? finalizeLoanPayout(intent.id) : finalizeShareoutPayout(intent.id))} disabled={readOnly || busy === `finalize-payout:${intent.id}` || busy === `finalize-shareout:${intent.id}`} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy === `finalize-payout:${intent.id}` || busy === `finalize-shareout:${intent.id}` ? "Finalizing…" : "Finalize payout"}</button></div>)}</div></section>}
    <section className="rounded-xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-indigo-700"/><div><h2 className="font-semibold text-slate-900">Incoming payment evidence</h2><p className="text-sm text-slate-600">Only trusted payment services can create provider events. Amount, currency, direction, and organization must match before a staff member can link them.</p></div></div><div className="mt-4 space-y-3">{unmatchedEvents.length === 0 ? <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">No unmatched provider events. Once a provider is configured, incoming receipts and payout confirmations will appear here.</p> : unmatchedEvents.map((event) => { const eligible = availableIntents(event); return <div key={event.id} className="rounded-xl border border-amber-200 p-4"><div className="flex flex-wrap justify-between gap-2"><div><p className="font-semibold text-slate-900">{event.provider} · {event.provider_reference}</p><p className="text-sm text-slate-600">{event.direction} · {event.channel.replace(/_/g, " ")} · {Number(event.amount).toLocaleString()} {event.currency}</p></div><span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">{event.status}</span></div>{event.failure_reason && <p className="mt-2 text-sm text-rose-700">Provider exception: {event.failure_reason}</p>}<div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><select aria-label={`Payment request for ${event.provider_reference}`} value={selectedIntent[event.id] ?? ""} onChange={(input) => setSelectedIntent((current) => ({ ...current, [event.id]: input.target.value }))} disabled={readOnly || eligible.length === 0} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">{eligible.length ? "Select matching payment request" : "No amount-compatible request"}</option>{eligible.map((intent) => <option key={intent.id} value={intent.id}>{intent.purpose.replace(/_/g, " ")} · {intent.provider_reference}</option>)}</select><input aria-label={`Reconciliation note for ${event.provider_reference}`} value={notes[event.id] ?? ""} onChange={(input) => setNotes((current) => ({ ...current, [event.id]: input.target.value }))} placeholder="Reconciliation note (optional)" disabled={readOnly} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"/><button type="button" onClick={() => void match(event.id)} disabled={readOnly || busy === event.id || !selectedIntent[event.id]} className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Link2 className="h-4 w-4"/>{busy === event.id ? "Matching…" : "Match"}</button></div></div>; })}</div></section>
    <section className="rounded-xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-700"/><div><h2 className="font-semibold text-slate-900">Matched receipt settlement</h2><p className="text-sm text-slate-600">Savings and loan repayments require a second authorized staff member to settle the independently matched provider receipt into the VSLA ledger.</p></div></div><div className="mt-4 space-y-3">{matchedReceipts.length === 0 ? <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">No matched incoming receipts await settlement.</p> : matchedReceipts.map((intent) => <div key={intent.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 p-4"><div><p className="font-semibold text-slate-900">{intent.purpose.replace(/_/g, " ")} · {intent.provider_reference}</p><p className="text-sm text-slate-600">{Number(intent.amount).toLocaleString()} {intent.currency} · {intent.provider} · {intent.channel.replace(/_/g, " ")}</p></div><button type="button" onClick={() => void settle(intent.id)} disabled={readOnly || busy === `settle:${intent.id}`} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy === `settle:${intent.id}` ? "Settling…" : "Settle to ledger"}</button></div>)}</div></section>
    <section className="rounded-xl border border-rose-200 bg-rose-50 p-5"><div className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-rose-700"/><div><h2 className="font-semibold text-rose-950">Provider reversals requiring action</h2><p className="text-sm text-rose-900">A provider failure, reversal, or refund arrived after settlement. The balance is unchanged until a different authorized staff member posts the controlled ledger reversal.</p></div></div><div className="mt-4 space-y-3">{reversalPending.length === 0 ? <p className="rounded-lg bg-white/70 p-4 text-sm text-slate-600">No settled receipts require a provider-reversal resolution.</p> : reversalPending.map((intent) => <div key={intent.id} className="grid gap-2 rounded-xl border border-rose-200 bg-white p-4 sm:grid-cols-[1fr_1fr_auto]"><div><p className="font-semibold text-slate-900">{intent.purpose.replace(/_/g, " ")} · {intent.provider_reference}</p><p className="text-sm text-slate-600">{Number(intent.amount).toLocaleString()} {intent.currency}</p></div><input aria-label={`Reversal reason for ${intent.provider_reference}`} value={notes[`reversal:${intent.id}`] ?? ""} onChange={(input) => setNotes((current) => ({ ...current, [`reversal:${intent.id}`]: input.target.value }))} placeholder="Required reversal reason" disabled={readOnly} className="rounded-lg border border-rose-300 px-3 py-2 text-sm"/><button type="button" onClick={() => void resolveReversal(intent.id)} disabled={readOnly || busy === `reversal:${intent.id}`} className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy === `reversal:${intent.id}` ? "Reversing…" : "Post controlled reversal"}</button></div>)}</div></section>
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-200 p-5"><h2 className="font-semibold text-slate-900">Payment requests</h2><p className="mt-1 text-sm text-slate-600">Provider requests are traceable, but they are not receipts or final settlement.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="bg-slate-50 text-left text-slate-600"><tr><th className="p-3">Created</th><th className="p-3">Purpose</th><th className="p-3">Reference</th><th className="p-3">Channel</th><th className="p-3 text-right">Amount</th><th className="p-3">Status</th></tr></thead><tbody>{intents.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-slate-500">No VSLA digital payment requests yet.</td></tr> : intents.map((intent) => <tr key={intent.id} className="border-t border-slate-100"><td className="p-3">{new Date(intent.created_at).toLocaleString()}</td><td className="p-3 capitalize">{intent.purpose.replace(/_/g, " ")}</td><td className="p-3 font-mono text-xs">{intent.provider_reference}</td><td className="p-3">{intent.provider} · {intent.channel.replace(/_/g, " ")}</td><td className="p-3 text-right">{Number(intent.amount).toLocaleString()} {intent.currency}</td><td className="p-3">{intent.status.replace(/_/g, " ")}</td></tr>)}</tbody></table></div></section>
  </div>;
}
