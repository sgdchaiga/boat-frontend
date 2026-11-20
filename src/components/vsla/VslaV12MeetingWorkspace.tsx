import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";
import { VslaV12AttendanceSummary, VslaV12SharePurchaseSummary } from "@/components/vsla/VslaV12MeetingEnhancements";
import {
  type VslaOfflineCollection,
  clearVslaOfflineMeetingSnapshot,
  discardRejectedVslaOfflineCollection,
  getVslaOfflineDeviceId,
  queueVslaOfflineCollection,
  readVslaOfflineMeetingSnapshot,
  readVslaOfflineCollections,
  saveVslaOfflineMeetingSnapshot,
  subscribeToVslaOfflineQueue,
  syncVslaOfflineCollections,
} from "@/lib/vslaOfflineQueue";

type Meeting = { id: string; meeting_date: string; status: "open" | "scheduled" | "closed" };
type Reconciliation = { expected_closing_cash: number; actual_physical_cash: number; variance: number; status: "reconciled" | "requires_approval" };
type Member = { id: string; full_name: string; member_number: string | null };
type Loan = { id: string; member_id: string; outstanding_balance: number; status: string };
type Approval = { id: string; event_id: string; status: string };
type FinancialEvent = { id: string; event_type: string; amount: number; metadata: { loan_id?: string } | null };
type SharePurchase = { id: string; member_id: string; amount: number; metadata: { shares?: number; share_value?: number } | null };

export function VslaV12MeetingWorkspace({ readOnly = false }: { readOnly?: boolean }) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [eventsById, setEventsById] = useState<Record<string, FinancialEvent>>({});
  const [attendance, setAttendance] = useState<Record<string, boolean>>({});
  const [sharePurchases, setSharePurchases] = useState<SharePurchase[]>([]);
  const [memberId, setMemberId] = useState("");
  const [collectionType, setCollectionType] = useState<"savings" | "fine" | "social">("savings");
  const [shares, setShares] = useState("1");
  const [collectionAmount, setCollectionAmount] = useState("");
  const [loanPrincipal, setLoanPrincipal] = useState("");
  const [loanRate, setLoanRate] = useState("10");
  const [loanTerm, setLoanTerm] = useState("4");
  const [repayLoanId, setRepayLoanId] = useState("");
  const [repayAmount, setRepayAmount] = useState("");
  const [meetingNotes, setMeetingNotes] = useState("");
  const [chairName, setChairName] = useState("");
  const [secretaryName, setSecretaryName] = useState("");
  const [openingCash, setOpeningCash] = useState("0");
  const [actualCash, setActualCash] = useState("0");
  const [loanDisbursementChannel, setLoanDisbursementChannel] = useState<"cash" | "mobile_money">("cash");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [offlineCollections, setOfflineCollections] = useState<VslaOfflineCollection[]>([]);
  const [offlineDeviceDesignated, setOfflineDeviceDesignated] = useState(false);
  const [offlineSnapshotAt, setOfflineSnapshotAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    const loadOfflineSnapshot = async () => {
      const snapshot = await readVslaOfflineMeetingSnapshot(orgId);
      if (!snapshot) return false;
      setMeeting(snapshot.meeting);
      setMembers(snapshot.members);
      setLoans(snapshot.loans);
      setApprovals([]);
      setEventsById({});
      setAttendance({});
      setSharePurchases([]);
      setReconciliation(null);
      setOfflineSnapshotAt(snapshot.savedAt);
      setError(null);
      return true;
    };
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      if (await loadOfflineSnapshot()) return;
      setError("No encrypted meeting context is available on this device. Reconnect before starting this meeting workspace.");
      return;
    }
    const { data: openMeeting, error: meetingError } = await supabase.from("vsla_meetings").select("id,meeting_date,status").eq("organization_id", orgId).eq("status", "open").maybeSingle();
    if (meetingError) { if (await loadOfflineSnapshot()) return; setError(meetingError.message); return; }
    setOfflineSnapshotAt(null);
    setMeeting(openMeeting as Meeting | null);
    const { data: activeMembers, error: membersError } = await supabase.from("vsla_members").select("id,full_name,member_number").eq("organization_id", orgId).eq("status", "active").order("full_name");
    if (membersError) { if (await loadOfflineSnapshot()) return; setError(membersError.message); return; }
    const activeMemberRows = (activeMembers as Member[] | null) ?? [];
    setMembers(activeMemberRows);
    const [loanRows, approvalRows] = await Promise.all([
      (supabase as any).from("vsla_v12_loans").select("id,member_id,outstanding_balance,status").eq("organization_id", orgId).in("status", ["disbursed", "pending_approval", "approved_pending_payout"]).order("created_at", { ascending: false }),
      (supabase as any).from("vsla_financial_approval_requests").select("id,event_id,status").eq("organization_id", orgId).eq("status", "pending").order("submitted_at", { ascending: false }),
    ]);
    setLoans((loanRows.data as Loan[] | null) ?? []);
    const loanRowsForSnapshot = (loanRows.data as Loan[] | null) ?? [];
    const pendingApprovals = (approvalRows.data as Approval[] | null) ?? [];
    setApprovals(pendingApprovals);
    if (pendingApprovals.length) {
      const { data: pendingEvents } = await (supabase as any).from("vsla_financial_events").select("id,event_type,amount,metadata").in("id", pendingApprovals.map((row) => row.event_id));
      setEventsById(Object.fromEntries(((pendingEvents as FinancialEvent[] | null) ?? []).map((event) => [event.id, event])));
    } else setEventsById({});
    if (openMeeting?.id) {
      const [attendanceResult, reconciliationResult, purchaseResult] = await Promise.all([
        supabase.from("vsla_meeting_attendance").select("member_id,present").eq("meeting_id", openMeeting.id),
        (supabase as any).from("vsla_v12_cash_reconciliations").select("expected_closing_cash,actual_physical_cash,variance,status").eq("meeting_id", openMeeting.id).maybeSingle(),
        (supabase as any).from("vsla_financial_events").select("id,member_id,amount,metadata").eq("meeting_id", openMeeting.id).eq("event_type", "savings_received").eq("status", "posted").order("posted_at", { ascending: false }),
      ]);
      setAttendance(Object.fromEntries(((attendanceResult.data ?? []) as Array<{ member_id: string; present: boolean }>).map((row) => [row.member_id, row.present])));
      setReconciliation((reconciliationResult.data as Reconciliation | null) ?? null);
      setSharePurchases((purchaseResult.data as SharePurchase[] | null) ?? []);
      void saveVslaOfflineMeetingSnapshot({ organizationId: orgId, meeting: { id: openMeeting.id, meeting_date: openMeeting.meeting_date, status: "open" }, members: activeMemberRows, loans: loanRowsForSnapshot });
    } else { setReconciliation(null); setAttendance({}); setSharePurchases([]); void clearVslaOfflineMeetingSnapshot(orgId); }
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  const refreshOfflineCollections = useCallback(async () => {
    if (!orgId) { setOfflineCollections([]); return; }
    setOfflineCollections(await readVslaOfflineCollections(orgId));
  }, [orgId]);

  const refreshOfflineDevice = useCallback(async () => {
    if (!orgId || typeof navigator === "undefined" || !navigator.onLine) return;
    const { data, error: deviceError } = await supabase.rpc("vsla_v12_is_offline_device_designated", { p_device_id: getVslaOfflineDeviceId() });
    if (!deviceError) setOfflineDeviceDesignated(data === true);
  }, [orgId]);

  const syncOfflineCollections = useCallback(async () => {
    if (!orgId || typeof navigator === "undefined" || !navigator.onLine) {
      await refreshOfflineCollections();
      return;
    }
    try {
      setOfflineCollections(await syncVslaOfflineCollections(orgId));
      await load();
    } catch {
      await refreshOfflineCollections();
    }
  }, [load, orgId, refreshOfflineCollections]);

  const discardRejectedOfflineItem = async (id: string) => {
    setBusy(true); setError(null); setMessage(null);
    try {
      await discardRejectedVslaOfflineCollection(id);
      await refreshOfflineCollections();
      setMessage("Rejected local item removed. Re-enter a corrected transaction while online or from the designated device.");
    } catch (discardError) {
      setError(discardError instanceof Error ? discardError.message : "Unable to remove the rejected local item.");
    }
    setBusy(false);
  };

  useEffect(() => {
    void refreshOfflineCollections();
    void refreshOfflineDevice();
    const onOnline = () => { setIsOnline(true); void refreshOfflineDevice(); void syncOfflineCollections(); };
    const onOffline = () => { setIsOnline(false); void refreshOfflineCollections(); };
    const onQueueChange = () => { void refreshOfflineCollections(); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const unsubscribe = subscribeToVslaOfflineQueue(onQueueChange);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      unsubscribe();
    };
  }, [refreshOfflineCollections, refreshOfflineDevice, syncOfflineCollections]);

  const openMeeting = async () => {
    if (readOnly) return;
    setBusy(true); setError(null); setMessage(null);
    const { error: rpcError } = await supabase.rpc("vsla_v12_open_meeting", { p_meeting_date: new Date().toISOString().slice(0, 10) });
    if (rpcError) setError(rpcError.message); else { setMessage("Meeting opened. Continue with the controlled meeting steps below."); await load(); }
    setBusy(false);
  };

  const reconcileCash = async () => {
    if (readOnly || !meeting) return;
    if (!isOnline) { setError("Cash reconciliation is unavailable offline. Reconnect and sync provisional collections first."); return; }
    setBusy(true); setError(null); setMessage(null);
    const { error: rpcError } = await supabase.rpc("vsla_v12_reconcile_meeting_cash", { p_meeting_id: meeting.id, p_opening_cash: Number(openingCash), p_actual_physical_cash: Number(actualCash) });
    if (rpcError) setError(rpcError.message); else { setMessage("Cash count saved and independently calculated from posted v1.2 events."); await load(); }
    setBusy(false);
  };

  const receiveCollection = async () => {
    if (readOnly || !meeting || !memberId) { setError("Choose a member before recording a collection."); return; }
    setBusy(true); setError(null); setMessage(null);
    const sharesValue = Number(shares);
    const amountValue = Number(collectionAmount);
    if ((collectionType === "savings" && (!Number.isInteger(sharesValue) || sharesValue < 1)) || (collectionType !== "savings" && (!Number.isFinite(amountValue) || amountValue <= 0))) {
      setError(collectionType === "savings" ? "Enter at least one whole share." : "Enter a collection amount greater than zero.");
      setBusy(false);
      return;
    }
    if (!isOnline) {
      if (!offlineDeviceDesignated) {
        setError("This browser is not the designated VSLA offline device. Reconnect, then designate it in Group setup before queuing collections.");
        setBusy(false);
        return;
      }
      try {
        await queueVslaOfflineCollection({
          organizationId: orgId ?? "",
          meetingId: meeting.id,
          memberId,
          kind: collectionType,
          ...(collectionType === "savings" ? { shares: sharesValue } : { amount: amountValue }),
        });
        setCollectionAmount("");
        setMessage("Saved as a provisional offline collection. It is not in the ledger or cash total until this device reconnects and the server accepts it.");
        await refreshOfflineCollections();
      } catch (queueError) {
        setError(queueError instanceof Error ? queueError.message : "Unable to securely queue the offline collection.");
      }
      setBusy(false);
      return;
    }
    const idempotencyKey = crypto.randomUUID();
    const result = collectionType === "savings"
      ? await supabase.rpc("vsla_v12_receive_savings", { p_meeting_id: meeting.id, p_member_id: memberId, p_shares: sharesValue, p_idempotency_key: idempotencyKey })
      : await supabase.rpc("vsla_v12_receive_member_collection", { p_meeting_id: meeting.id, p_member_id: memberId, p_event_type: collectionType === "fine" ? "fine_received" : "social_fund_received", p_amount: amountValue, p_idempotency_key: idempotencyKey });
    if (result.error) setError(result.error.message); else { setMessage(`${collectionType === "savings" ? "Savings" : collectionType === "fine" ? "Fine" : "Social fund contribution"} recorded in the controlled ledger.`); setCollectionAmount(""); await load(); }
    setBusy(false);
  };

  const requestLoan = async () => {
    if (readOnly || !meeting || !memberId) { setError("Choose a member before requesting a loan."); return; }
    if (!isOnline) { setError("Loan requests require a live server connection."); return; }
    setBusy(true); setError(null); setMessage(null);
    const { error: rpcError } = await supabase.rpc(loanDisbursementChannel === "mobile_money" ? "vsla_v12_request_digital_loan" : "vsla_v12_request_loan", { p_meeting_id: meeting.id, p_member_id: memberId, p_principal: Number(loanPrincipal), p_interest_rate: Number(loanRate), p_duration: Number(loanTerm), p_idempotency_key: crypto.randomUUID() });
    if (rpcError) setError(rpcError.message); else { setLoanPrincipal(""); setMessage(loanDisbursementChannel === "mobile_money" ? "Digital loan request sent for approval. It will remain pending until provider payout confirmation." : "Loan request sent for independent approval."); await load(); }
    setBusy(false);
  };

  const receiveRepayment = async () => {
    if (readOnly || !meeting || !repayLoanId) { setError("Choose a loan before receiving repayment."); return; }
    const repaymentValue = Number(repayAmount);
    const selectedLoan = loans.find((loan) => loan.id === repayLoanId);
    if (!Number.isFinite(repaymentValue) || repaymentValue <= 0) { setError("Enter a repayment amount greater than zero."); return; }
    if (!selectedLoan) { setError("The selected loan is no longer available. Reload the meeting before continuing."); return; }
    if (!isOnline) {
      if (!offlineDeviceDesignated) { setError("This browser is not the designated VSLA offline device. Reconnect, then designate it in Group setup before queuing repayments."); return; }
      setBusy(true); setError(null); setMessage(null);
      try {
        await queueVslaOfflineCollection({ organizationId: orgId ?? "", meetingId: meeting.id, memberId: selectedLoan.member_id, loanId: selectedLoan.id, kind: "loan_repayment", amount: repaymentValue });
        setRepayAmount("");
        setMessage("Saved as a provisional offline repayment. It is not in the ledger, loan balance, or cash total until this device reconnects and the server accepts it.");
        await refreshOfflineCollections();
      } catch (queueError) {
        setError(queueError instanceof Error ? queueError.message : "Unable to securely queue the offline repayment.");
      }
      setBusy(false);
      return;
    }
    setBusy(true); setError(null); setMessage(null);
    const { error: rpcError } = await supabase.rpc("vsla_v12_receive_loan_repayment", { p_meeting_id: meeting.id, p_loan_id: repayLoanId, p_amount: repaymentValue, p_idempotency_key: crypto.randomUUID() });
    if (rpcError) setError(rpcError.message); else { setRepayAmount(""); setMessage("Loan repayment recorded in the controlled ledger."); await load(); }
    setBusy(false);
  };

  const decideApproval = async (requestId: string, approve: boolean) => {
    if (readOnly) return;
    if (!isOnline) { setError("Approval decisions require a live server connection."); return; }
    setBusy(true); setError(null); setMessage(null);
    const { error: rpcError } = await supabase.rpc("vsla_v12_decide_financial_approval", { p_request_id: requestId, p_approve: approve, p_note: null });
    if (rpcError) setError(rpcError.message); else { setMessage(approve ? "Request approved and posted." : "Request rejected."); await load(); }
    setBusy(false);
  };

  const setMemberAttendance = async (targetMemberId: string, present: boolean) => {
    if (readOnly || !meeting) return;
    if (!isOnline) { setError("Attendance recording requires a live server connection."); return; }
    setBusy(true); setError(null);
    const { error: rpcError } = await supabase.rpc("vsla_v12_set_attendance", { p_meeting_id: meeting.id, p_member_id: targetMemberId, p_present: present });
    if (rpcError) setError(rpcError.message); else setAttendance((value) => ({ ...value, [targetMemberId]: present }));
    setBusy(false);
  };

  const setAllAttendance = async (present: boolean) => {
    if (readOnly || !meeting || members.length === 0) return;
    if (!isOnline) { setError("Attendance recording requires a live server connection."); return; }
    setBusy(true); setError(null); setMessage(null);
    const results = await Promise.all(members.map((member) => supabase.rpc("vsla_v12_set_attendance", { p_meeting_id: meeting.id, p_member_id: member.id, p_present: present })));
    const failed = results.find((result) => result.error)?.error;
    if (failed) setError(failed.message);
    else {
      setAttendance(Object.fromEntries(members.map((member) => [member.id, present])));
      setMessage(`${members.length} members marked ${present ? "present" : "absent"}.`);
    }
    setBusy(false);
  };

  const closeMeeting = async () => {
    if (readOnly || !meeting) return;
    if (!isOnline) { setError("A meeting cannot be closed while offline."); return; }
    if (offlineCollections.some((row) => row.status === "queued" || row.status === "syncing")) { setError("Sync or resolve every provisional offline collection before closing the meeting."); return; }
    setBusy(true); setError(null); setMessage(null);
    const { error: rpcError } = await supabase.rpc("vsla_v12_close_meeting", { p_meeting_id: meeting.id, p_notes: meetingNotes, p_chair_name: chairName, p_secretary_name: secretaryName });
    if (rpcError) setError(rpcError.message); else { setMessage("Meeting closed and locked successfully."); await load(); }
    setBusy(false);
  };

  return <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6 lg:p-8">
    {readOnly && <ReadOnlyNotice />}
    <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4"><p className="text-xs font-bold uppercase tracking-wider text-indigo-700">VSLA v1.2 · controlled workflow</p><h1 className="mt-1 text-2xl font-bold text-slate-900">Meeting workspace</h1><p className="mt-1 text-sm text-slate-700">Post financial actions through the controlled ledger, then count cash from the verified records.</p></div>
    <section className={`rounded-xl border p-4 ${isOnline ? "border-emerald-200 bg-emerald-50" : "border-amber-300 bg-amber-50"}`} aria-live="polite"><p className={`text-sm font-semibold ${isOnline ? "text-emerald-900" : "text-amber-950"}`}>{isOnline ? "Online · server controls active" : "Offline · transactions are provisional"}</p><p className="mt-1 text-sm text-slate-700">{isOnline ? "The server is the source of truth. Any queued transaction will be posted only after server validation." : offlineDeviceDesignated ? "Only routine collections and loan repayments can be queued on this designated meeting device. Do not reconcile cash or close the meeting until they have synced." : "This browser is not designated for offline collections. Reconnect and select it in Group setup before taking offline entries."}</p>{offlineSnapshotAt && !isOnline && <p className="mt-2 text-xs text-amber-900">Using encrypted meeting context saved {new Date(offlineSnapshotAt).toLocaleString()}. Confirm all information after reconnection.</p>}{offlineCollections.length > 0 && <div className="mt-3 space-y-2"><p className="text-sm font-semibold text-slate-900">Offline transaction queue ({offlineCollections.length})</p>{offlineCollections.map((row) => <div key={row.id} className={`rounded-lg bg-white p-3 text-sm ${row.status === "rejected" ? "border border-rose-200" : "border border-amber-200"}`}><p className="font-medium text-slate-900">{members.find((member) => member.id === row.memberId)?.full_name ?? "Member"} · {row.kind === "savings" ? `${row.shares} share${row.shares === 1 ? "" : "s"}` : row.kind === "loan_repayment" ? `Loan repayment ${Number(row.amount ?? 0).toLocaleString()}` : `${row.kind === "fine" ? "Fine" : "Social fund"} ${Number(row.amount ?? 0).toLocaleString()}`}</p><p className={row.status === "rejected" ? "mt-1 text-rose-700" : "mt-1 text-amber-800"}>{row.status === "rejected" ? `Rejected by the server: ${row.rejectionReason ?? "review and re-enter the transaction"}` : "Provisional — awaiting secure sync and server acceptance."}</p>{row.status === "rejected" && <button type="button" onClick={() => void discardRejectedOfflineItem(row.id)} disabled={busy} className="mt-2 rounded border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-800 disabled:opacity-50">Remove rejected local record</button>}</div>)}</div>}</section>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {message && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
    {meeting && <VslaV12AttendanceSummary members={members} attendance={attendance} disabled={readOnly || busy || !isOnline} onSetAll={(present) => void setAllAttendance(present)} />}
    {meeting && <VslaV12SharePurchaseSummary purchases={sharePurchases} members={members} />}
    {!meeting ? <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold text-slate-900">Start today’s meeting</h2><p className="mt-1 text-sm text-slate-600">Only a chairperson, treasurer, or secretary assigned by Super Admin can open a v1.2 meeting.</p><button type="button" onClick={() => void openMeeting()} disabled={readOnly || busy || !isOnline} className="mt-4 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Opening…" : "Open meeting"}</button></section> : <>
      <section className="rounded-xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-500">Open meeting</p><h2 className="text-xl font-bold text-slate-900">{meeting.meeting_date}</h2><p className="mt-2 text-sm text-slate-600">Receive routine member collections with a reference and server-side duplicate protection.</p><div className="mt-4 grid gap-3 sm:grid-cols-3"><label className="text-sm text-slate-700">Collection<select value={collectionType} onChange={(e) => setCollectionType(e.target.value as typeof collectionType)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"><option value="savings">Receive savings</option><option value="fine">Record fine</option><option value="social">Social fund</option></select></label><label className="text-sm text-slate-700 sm:col-span-2">Member<select value={memberId} onChange={(e) => setMemberId(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"><option value="">Select member</option>{members.map((member) => <option key={member.id} value={member.id}>{member.full_name}{member.member_number ? ` (${member.member_number})` : ""}</option>)}</select></label>{collectionType === "savings" ? <label className="text-sm text-slate-700">Shares<input type="number" min="1" value={shares} onChange={(e) => setShares(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"/></label> : <label className="text-sm text-slate-700">Amount<input type="number" min="0" value={collectionAmount} onChange={(e) => setCollectionAmount(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"/></label>}</div><button type="button" onClick={() => void receiveCollection()} disabled={readOnly || busy} className="mt-4 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : collectionType === "savings" ? "Receive savings" : "Record collection"}</button></section>
      <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold text-slate-900">Loans</h2><div className="mt-3 grid gap-3 sm:grid-cols-4"><label className="text-sm text-slate-700 sm:col-span-2">Member<select value={memberId} onChange={(e) => setMemberId(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"><option value="">Select member</option>{members.map((member) => <option key={member.id} value={member.id}>{member.full_name}</option>)}</select></label><label className="text-sm text-slate-700">Principal<input type="number" min="1" value={loanPrincipal} onChange={(e) => setLoanPrincipal(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"/></label><label className="text-sm text-slate-700">Interest %<input type="number" min="0" value={loanRate} onChange={(e) => setLoanRate(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"/></label><label className="text-sm text-slate-700">Meetings<input type="number" min="1" value={loanTerm} onChange={(e) => setLoanTerm(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"/></label><label className="text-sm text-slate-700">Disbursement<select value={loanDisbursementChannel} onChange={(e) => setLoanDisbursementChannel(e.target.value as "cash" | "mobile_money")} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"><option value="cash">Cash after approval</option><option value="mobile_money">Mobile money after confirmation</option></select></label></div><p className="mt-3 text-sm text-slate-600">Mobile-money loans are approved first and are not posted as disbursed until a separate provider payout is matched and finalized.</p><button type="button" onClick={() => void requestLoan()} disabled={readOnly || busy} className="mt-4 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Request loan approval</button><div className="mt-5 grid gap-3 sm:grid-cols-3"><label className="text-sm text-slate-700 sm:col-span-2">Receive repayment<select value={repayLoanId} onChange={(e) => setRepayLoanId(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"><option value="">Select active loan</option>{loans.filter((loan) => loan.status === "disbursed").map((loan) => <option key={loan.id} value={loan.id}>{members.find((member) => member.id === loan.member_id)?.full_name ?? "Member"} — {Number(loan.outstanding_balance).toLocaleString()}</option>)}</select></label><label className="text-sm text-slate-700">Amount<input type="number" min="1" value={repayAmount} onChange={(e) => setRepayAmount(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"/></label></div><button type="button" onClick={() => void receiveRepayment()} disabled={readOnly || busy} className="mt-3 rounded-lg border border-emerald-700 px-4 py-2 text-sm font-semibold text-emerald-800 disabled:opacity-50">Receive repayment</button></section>
      {approvals.length > 0 && <section className="rounded-xl border border-amber-200 bg-amber-50 p-5"><h2 className="font-semibold text-amber-950">Approval queue</h2><div className="mt-3 space-y-2">{approvals.map((approval) => { const event = eventsById[approval.event_id]; return <div key={approval.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white p-3 text-sm"><span>{event?.event_type?.replace(/_/g, " ") ?? "Restricted action"} · {Number(event?.amount ?? 0).toLocaleString()}</span><div className="flex gap-2"><button type="button" onClick={() => void decideApproval(approval.id, true)} disabled={readOnly || busy} className="rounded bg-emerald-700 px-3 py-1.5 text-white disabled:opacity-50">Approve</button><button type="button" onClick={() => void decideApproval(approval.id, false)} disabled={readOnly || busy} className="rounded border border-rose-300 px-3 py-1.5 text-rose-800 disabled:opacity-50">Reject</button></div></div>; })}</div></section>}
      <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold text-slate-900">Attendance</h2><p className="mt-1 text-sm text-slate-600">Mark every active member present or absent before closing.</p><div className="mt-3 divide-y divide-slate-100">{members.map((member) => <div key={member.id} className="flex items-center justify-between gap-3 py-2 text-sm"><span>{member.full_name}{member.member_number ? ` (${member.member_number})` : ""}</span><div className="flex gap-2"><button type="button" onClick={() => void setMemberAttendance(member.id, true)} disabled={readOnly || busy} className={`rounded px-3 py-1 ${attendance[member.id] === true ? "bg-emerald-700 text-white" : "bg-slate-100"}`}>Present</button><button type="button" onClick={() => void setMemberAttendance(member.id, false)} disabled={readOnly || busy} className={`rounded px-3 py-1 ${attendance[member.id] === false ? "bg-rose-700 text-white" : "bg-slate-100"}`}>Absent</button></div></div>)}</div></section>
      <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold text-slate-900">Close meeting</h2><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm text-slate-700 sm:col-span-2">Meeting notes<textarea value={meetingNotes} onChange={(e) => setMeetingNotes(e.target.value)} className="mt-1 block min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Decisions, actions, and exceptions…"/></label><label className="text-sm text-slate-700">Chairperson confirmation<input value={chairName} onChange={(e) => setChairName(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"/></label><label className="text-sm text-slate-700">Secretary confirmation<input value={secretaryName} onChange={(e) => setSecretaryName(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"/></label></div><button type="button" onClick={() => void closeMeeting()} disabled={readOnly || busy} className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Close and lock meeting</button></section>
      <section className="rounded-xl border border-slate-200 bg-white p-5"><div className="flex gap-3"><Wallet className="mt-0.5 h-5 w-5 text-indigo-700"/><div><h2 className="font-semibold text-slate-900">Count cash</h2><p className="text-sm text-slate-600">Expected cash is calculated by the server from confirmed v1.2 events, never typed by the user.</p></div></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-sm text-slate-700">Opening cash<input type="number" min="0" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"/></label><label className="text-sm text-slate-700">Physical cash counted<input type="number" min="0" value={actualCash} onChange={(e) => setActualCash(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"/></label></div><button type="button" onClick={() => void reconcileCash()} disabled={readOnly || busy} className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Calculating…" : "Save cash count"}</button>{reconciliation && <div className={`mt-4 rounded-lg p-4 text-sm ${reconciliation.status === "reconciled" ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}><div className="flex gap-2">{reconciliation.status === "reconciled" ? <CheckCircle2 className="h-5 w-5"/> : <AlertTriangle className="h-5 w-5"/>}<div><p className="font-semibold">{reconciliation.status === "reconciled" ? "Cash reconciled" : "Variance requires approval"}</p><p className="mt-1">Expected: {Number(reconciliation.expected_closing_cash).toLocaleString()} · Counted: {Number(reconciliation.actual_physical_cash).toLocaleString()} · Difference: {Number(reconciliation.variance).toLocaleString()}</p></div></div></div>}</section>
    </>}
  </div>;
}
