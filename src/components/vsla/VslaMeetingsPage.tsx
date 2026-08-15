import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";
import { VSLA_PAGE } from "@/lib/vslaPages";
import { formatVslaMemberLabel } from "@/lib/vslaMemberLabel";
import { Check, ChevronLeft, ChevronRight, Circle } from "lucide-react";

type MeetingStatus = "scheduled" | "open" | "closed";
type MeetingRow = {
  id: string;
  meeting_date: string;
  minutes: string | null;
  status: MeetingStatus;
  completed_steps: string[];
  minutes_status: "draft" | "final";
};
type MemberRow = {
  id: string;
  full_name: string;
  member_number: string | null;
};
type AttendanceRow = {
  id: string;
  meeting_id: string;
  member_id: string;
  present: boolean;
};
type LoanRow = {
  id: string;
  member_id: string;
  status: string;
  outstanding_balance: number;
  principal_amount: number;
  interest_rate_percent: number;
  interest_type: "flat" | "declining";
  duration_meetings: number;
  disbursed_on: string | null;
  disbursement_meeting_id: string | null;
};
type RepaymentRow = { id: string; meeting_id: string | null; loan_id: string; principal_paid: number; interest_paid: number; penalty_paid: number; paid_on: string };
type VslaSettingsRow = { share_value: number; max_shares_per_meeting: number };
type TxnKind =
  | "loan_issue"
  | "loan_repayment"
  | "fine"
  | "social_payout"
  | "chairman_basket"
  | "refreshments";
type MeetingTxnRow = {
  id: string;
  meeting_id: string;
  member_id: string;
  kind: TxnKind;
  amount: number;
  note: string | null;
};
type ShareTxnRow = {
  id: string;
  meeting_id: string;
  member_id: string;
  shares_bought: number;
  share_value: number;
  total_value: number;
};

export function VslaMeetingsPage({
  readOnly = false,
  initialTab,
  initialDisburseLoanId,
  onNavigate,
}: {
  readOnly?: boolean;
  initialTab?: "attendance" | "savings" | "loans" | "repayments" | "cash";
  initialDisburseLoanId?: string;
  onNavigate?: (page: string, state?: Record<string, unknown>) => void;
}) {
  const { user, isSuperAdmin } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!isSuperAdmin;

  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [txns, setTxns] = useState<MeetingTxnRow[]>([]);
  const [shareTxns, setShareTxns] = useState<ShareTxnRow[]>([]);
  const [repayments, setRepayments] = useState<RepaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [meetingDate, setMeetingDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [selectedMeetingId, setSelectedMeetingId] = useState("");
  const [activeTab, setActiveTab] = useState<
    "attendance" | "savings" | "loans" | "repayments" | "cash" | "review"
  >("attendance");
  const [txnMemberId, setTxnMemberId] = useState("");
  const [txnKind, setTxnKind] = useState<TxnKind>("fine");
  const [txnAmount, setTxnAmount] = useState("0");
  const [txnNote, setTxnNote] = useState("");
  const [shareValue, setShareValue] = useState("2000");
  const [maxStamps, setMaxStamps] = useState(5);
  const [loanMemberId, setLoanMemberId] = useState("");
  const [loanAmount, setLoanAmount] = useState("");
  const [loanPeriod, setLoanPeriod] = useState("3");
  const [loanInterest, setLoanInterest] = useState("10");
  const [loanId, setLoanId] = useState("");
  const [principalPaid, setPrincipalPaid] = useState("0");
  const [interestPaid, setInterestPaid] = useState("0");
  const [openingCash, setOpeningCash] = useState("0");
  const [physicalCash, setPhysicalCash] = useState("0");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const mq = filterByOrganizationId(
      supabase
        .from("vsla_meetings")
        .select("id,meeting_date,minutes,status,completed_steps,minutes_status")
        .order("meeting_date", { ascending: false }),
      orgId,
      superAdmin,
    );
    const memQ = filterByOrganizationId(
      supabase
        .from("vsla_members")
        .select("id,full_name,member_number")
        .eq("status", "active")
        .order("full_name"),
      orgId,
      superAdmin,
    );
    const atQ = filterByOrganizationId(
      supabase
        .from("vsla_meeting_attendance")
        .select("id,meeting_id,member_id,present"),
      orgId,
      superAdmin,
    );
    const lnQ = filterByOrganizationId(
      supabase
        .from("vsla_loans")
        .select(
          "id,member_id,status,outstanding_balance,principal_amount,interest_rate_percent,interest_type,duration_meetings,disbursed_on,disbursement_meeting_id",
        )
        .order("applied_at", { ascending: false }),
      orgId,
      superAdmin,
    );
    const txQ = filterByOrganizationId(
      supabase
        .from("vsla_meeting_transactions")
        .select("id,meeting_id,member_id,kind,amount,note")
        .order("created_at", { ascending: false }),
      orgId,
      superAdmin,
    );
    const shareQ = filterByOrganizationId(
      supabase
        .from("vsla_share_transactions")
        .select("id,meeting_id,member_id,shares_bought,share_value,total_value")
        .order("created_at", { ascending: false }),
      orgId,
      superAdmin,
    );
    const settingsQ = filterByOrganizationId(
      supabase
        .from("vsla_settings")
        .select("share_value,max_shares_per_meeting")
        .maybeSingle(),
      orgId,
      superAdmin,
    );
    const repaymentQ = filterByOrganizationId(
      supabase.from("vsla_loan_repayments").select("id,meeting_id,loan_id,principal_paid,interest_paid,penalty_paid,paid_on").order("created_at", { ascending: false }),
      orgId, superAdmin,
    );
    const [
      meetingsRes,
      membersRes,
      attendanceRes,
      loansRes,
      txRes,
      shareRes,
      settingsRes, repaymentsRes,
    ] = await Promise.all([mq, memQ, atQ, lnQ, txQ, shareQ, settingsQ, repaymentQ]);
    if (
      meetingsRes.error ||
      membersRes.error ||
      attendanceRes.error ||
      loansRes.error ||
      txRes.error ||
      shareRes.error ||
      settingsRes.error || repaymentsRes.error
    ) {
      setError(
        meetingsRes.error?.message ??
          membersRes.error?.message ??
          attendanceRes.error?.message ??
          loansRes.error?.message ??
          txRes.error?.message ??
          shareRes.error?.message ??
          settingsRes.error?.message ??
          repaymentsRes.error?.message ??
          "Failed to load meetings.",
      );
    } else {
      const mt = (meetingsRes.data ?? []) as MeetingRow[];
      setMeetings(mt);
      setMembers((membersRes.data ?? []) as MemberRow[]);
      setAttendance((attendanceRes.data ?? []) as AttendanceRow[]);
      setLoans((loansRes.data ?? []) as LoanRow[]);
      setTxns((txRes.data ?? []) as MeetingTxnRow[]);
      setShareTxns((shareRes.data ?? []) as ShareTxnRow[]);
      setRepayments((repaymentsRes.data ?? []) as RepaymentRow[]);
      const settings = settingsRes.data as VslaSettingsRow | null;
      if (settings?.share_value != null)
        setShareValue(String(settings.share_value));
      if (
        settings?.max_shares_per_meeting != null &&
        settings.max_shares_per_meeting > 0
      ) {
        setMaxStamps(settings.max_shares_per_meeting);
      }
      if (!selectedMeetingId && mt[0]?.id) {
        setSelectedMeetingId(mt[0].id);
      }
    }
    setLoading(false);
  }, [orgId, selectedMeetingId, superAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
    if (initialDisburseLoanId) {
      setActiveTab("loans");
      const legacyLoan = loans.find((loan) => loan.id === initialDisburseLoanId);
      if (legacyLoan) {
        setLoanMemberId(legacyLoan.member_id);
        setLoanAmount(String(legacyLoan.principal_amount));
        setLoanInterest(String(legacyLoan.interest_rate_percent));
      }
    }
  }, [initialDisburseLoanId, initialTab, loans]);

  const selectedMeeting =
    meetings.find((m) => m.id === selectedMeetingId) ?? null;
  const meetingClosed = selectedMeeting?.status === "closed";
  const meetingOpen = selectedMeeting?.status === "open";
  const completedSteps = selectedMeeting?.completed_steps ?? [];

  const attendanceMap = useMemo(() => {
    const map = new Map<string, AttendanceRow>();
    for (const a of attendance) {
      if (a.meeting_id === selectedMeetingId) map.set(a.member_id, a);
    }
    return map;
  }, [attendance, selectedMeetingId]);

  const addMeeting = async () => {
    if (readOnly) return;
    if (!meetingDate) return;
    setSaving(true);
    setError(null);
    const { error: e } = await supabase.from("vsla_meetings").insert({
      organization_id: orgId,
      meeting_date: meetingDate,
      status: "scheduled",
      minutes: null,
    });
    if (e) setError(e.message);
    setSaving(false);
    await load();
  };

  const setMeetingStatus = async (status: MeetingStatus) => {
    if (readOnly || !selectedMeetingId) return;
    setSaving(true);
    setError(null);
    const { error: e } = await supabase
      .from("vsla_meetings")
      .update({ status })
      .eq("id", selectedMeetingId);
    if (e) setError(e.message);
    setSaving(false);
    await load();
  };

  const markAttendance = async (memberId: string, present: boolean) => {
    if (readOnly || !selectedMeetingId || meetingClosed) return;
    const existing = attendanceMap.get(memberId);
    if (existing) {
      await supabase
        .from("vsla_meeting_attendance")
        .update({ present })
        .eq("id", existing.id);
    } else {
      await supabase.from("vsla_meeting_attendance").insert({
        organization_id: orgId,
        meeting_id: selectedMeetingId,
        member_id: memberId,
        present,
      });
    }
    await load();
  };

  const markAllAttendance = async (present: boolean) => {
    if (readOnly || !selectedMeetingId || !meetingOpen || members.length === 0) return;
    setSaving(true);
    setError(null);
    const { error: attendanceError } = await supabase.from("vsla_meeting_attendance").upsert(
      members.map((member) => ({ organization_id: orgId, meeting_id: selectedMeetingId, member_id: member.id, present })),
      { onConflict: "meeting_id,member_id" },
    );
    if (attendanceError) setError(attendanceError.message);
    setSaving(false);
    await load();
  };

  const addMeetingTxn = async () => {
    if (readOnly || !selectedMeetingId || meetingClosed) return;
    const amount = Number(txnAmount || 0);
    if (!txnMemberId || !Number.isFinite(amount) || amount <= 0) {
      setError("Member and valid transaction amount are required.");
      return;
    }
    setSaving(true);
    setError(null);
    const { error: e } = await supabase
      .from("vsla_meeting_transactions")
      .insert({
        organization_id: orgId,
        meeting_id: selectedMeetingId,
        member_id: txnMemberId,
        kind: txnKind,
        amount,
        note: txnNote.trim() || null,
      });
    if (e) setError(e.message);
    setTxnAmount("0");
    setTxnNote("");
    setSaving(false);
    await load();
  };

  const recordMeetingLoan = async () => {
    if (readOnly || !selectedMeetingId || !meetingOpen) return;
    const amount = Number(loanAmount); const period = Number(loanPeriod); const interest = Number(loanInterest);
    if (!loanMemberId || amount <= 0 || !Number.isInteger(period) || period <= 0 || interest < 0) {
      setError("Member, loan disbursed, period and interest are required."); return;
    }
    setSaving(true);
    setError(null);
    const { error: postingError } = await supabase.rpc("vsla_record_meeting_loan", {
      p_meeting_id: selectedMeetingId,
      p_member_id: loanMemberId,
      p_principal: amount,
      p_period_months: period,
      p_interest_rate: interest,
      p_interest_type: "flat",
    });
    if (postingError) {
      setError(postingError.message);
      setSaving(false);
      return;
    }
    setLoanMemberId(""); setLoanAmount(""); setLoanPeriod("3");
    setSaving(false);
    await load();
  };

  const setMemberStamps = async (memberId: string, stamps: number) => {
    if (readOnly || !selectedMeetingId || meetingClosed) return;
    const value = Number(shareValue || 0);
    if (!memberId || stamps < 0 || value <= 0) return;
    setSaving(true);
    setError(null);
    // Keep one effective total per member per meeting.
    const { error: postingError } = await supabase.rpc(
      "vsla_set_member_meeting_shares",
      {
        p_meeting_id: selectedMeetingId,
        p_member_id: memberId,
        p_shares: stamps,
        p_share_value: value,
      },
    );
    if (postingError) {
      setError(postingError.message);
      setSaving(false);
      return;
    }
    setSaving(false);
    await load();
  };

  const postRepayment = async () => {
    if (readOnly || !selectedMeetingId || meetingClosed || !loanId) return;
    const p = Number(principalPaid || 0);
    const i = Number(interestPaid || 0);
    if (p + i <= 0) return;
    const loan = loans.find((l) => l.id === loanId);
    if (!loan) return;
    setSaving(true);
    setError(null);
    const { error: postingError } = await supabase.rpc(
      "vsla_post_loan_repayment",
      {
        p_loan_id: loanId,
        p_principal: p,
        p_interest: i,
        p_penalty: 0,
        p_meeting_id: selectedMeetingId,
        p_paid_on: selectedMeeting?.meeting_date ?? new Date().toISOString().slice(0, 10),
      },
    );
    if (postingError) {
      setError(postingError.message);
      setSaving(false);
      return;
    }
    setPrincipalPaid("0");
    setInterestPaid("0");
    setSaving(false);
    await load();
  };

  const markStepComplete = async (step: typeof activeTab) => {
    if (readOnly || !selectedMeetingId || !meetingOpen || step === "review") return;
    setSaving(true);
    setError(null);
    const { error: stepError } = await supabase.rpc("vsla_mark_meeting_step", {
      p_meeting_id: selectedMeetingId,
      p_step: step,
    });
    if (stepError) setError(stepError.message);
    setSaving(false);
    if (!stepError) await load();
  };

  const saveCashReconciliation = async () => {
    if (readOnly || !selectedMeetingId || !meetingOpen) return;
    const opening = Number(openingCash);
    const physical = Number(physicalCash);
    if (!Number.isFinite(opening) || !Number.isFinite(physical) || opening < 0 || physical < 0) {
      setError("Opening and physical cash must be valid non-negative amounts.");
      return;
    }
    setSaving(true);
    setError(null);
    const { error: cashError } = await supabase.rpc("vsla_save_meeting_cash_reconciliation", {
      p_meeting_id: selectedMeetingId,
      p_opening_cash: opening,
      p_inflow_savings: savingsTotal,
      p_inflow_repayments: repaymentsTotal,
      p_inflow_fines: finesTotal + chairmanBasket,
      p_outflow_loans: loansIssued,
      p_outflow_social_payouts: socialPayouts + refreshments,
      p_physical_cash: physical,
    });
    if (cashError) {
      setError(cashError.message);
      setSaving(false);
      return;
    }
    setSaving(false);
    await load();
  };

  const txnsForMeeting = txns.filter((t) => t.meeting_id === selectedMeetingId);
  const sharesForMeeting = shareTxns.filter(
    (t) => t.meeting_id === selectedMeetingId,
  );
  const memberStampsMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sharesForMeeting)
      map.set(
        s.member_id,
        (map.get(s.member_id) ?? 0) + Number(s.shares_bought || 0),
      );
    return map;
  }, [sharesForMeeting]);
  const savingsTotal = sharesForMeeting.reduce(
    (s, t) => s + Number(t.total_value || 0),
    0,
  );
  const repaymentsTotal = txnsForMeeting
    .filter((t) => t.kind === "loan_repayment")
    .reduce((s, t) => s + Number(t.amount || 0), 0);
  const finesTotal = txnsForMeeting
    .filter((t) => t.kind === "fine")
    .reduce((s, t) => s + Number(t.amount || 0), 0);
  const loansIssued = txnsForMeeting
    .filter((t) => t.kind === "loan_issue")
    .reduce((s, t) => s + Number(t.amount || 0), 0);
  const socialPayouts = txnsForMeeting
    .filter((t) => t.kind === "social_payout")
    .reduce((s, t) => s + Number(t.amount || 0), 0);
  const chairmanBasket = txnsForMeeting
    .filter((t) => t.kind === "chairman_basket")
    .reduce((s, t) => s + Number(t.amount || 0), 0);
  const refreshments = txnsForMeeting
    .filter((t) => t.kind === "refreshments")
    .reduce((s, t) => s + Number(t.amount || 0), 0);
  const memberName = new Map(
    members.map((m) => [m.id, formatVslaMemberLabel(m)]),
  );
  const loansForMeeting = loans.filter((loan) => loan.disbursement_meeting_id === selectedMeetingId);
  const repaymentsForMeeting = repayments.filter((repayment) => repayment.meeting_id === selectedMeetingId);
  const expectedCash =
    Number(openingCash || 0) +
    savingsTotal +
    repaymentsTotal +
    finesTotal +
    chairmanBasket -
    loansIssued -
    socialPayouts -
    refreshments;
  const cashVariance = Number(physicalCash || 0) - expectedCash;
  const workflowSteps = [
    { id: "attendance", label: "Attendance" },
    { id: "savings", label: "Shares" },
    { id: "loans", label: "Loans" },
    { id: "repayments", label: "Repayments" },
    { id: "cash", label: "Reconcile" },
    { id: "review", label: "Review" },
  ] as const;
  const activeStepIndex = workflowSteps.findIndex((step) => step.id === activeTab);
  const allWorkflowStepsComplete = workflowSteps
    .filter((step) => step.id !== "review")
    .every((step) => completedSteps.includes(step.id));
  const minutesFinal = selectedMeeting?.minutes_status === "final";
  const attendanceMarked = members.filter((member) => attendanceMap.has(member.id)).length;
  const presentCount = members.filter((member) => attendanceMap.get(member.id)?.present).length;

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {readOnly && <ReadOnlyNotice />}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          VSLA Meeting Management
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Meeting scheduling, attendance, minutes, and in-meeting transactions
          with close-lock behavior.
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
            Create Meeting
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-xs text-slate-600">
              Meeting Date
              <input
                type="date"
                value={meetingDate}
                onChange={(e) => setMeetingDate(e.target.value)}
                className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <div className="md:col-span-2 flex items-end">
              <button
                type="button"
                onClick={() => void addMeeting()}
                disabled={readOnly || saving}
                className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm disabled:opacity-50"
              >
                Schedule Meeting
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Meeting Mode
          </p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <label className="text-xs text-slate-600 md:col-span-2">
              Select Meeting
              <select
                value={selectedMeetingId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedMeetingId(id);
                  setActiveTab("attendance");
                }}
                className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Select meeting</option>
                {meetings.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.meeting_date} ({m.status})
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => void setMeetingStatus("open")}
                disabled={readOnly || saving || !selectedMeetingId || meetingClosed || meetingOpen}
                className="px-3 py-2 rounded-lg bg-emerald-700 text-white text-xs disabled:opacity-50"
              >
                Open
              </button>
              <button
                type="button"
                onClick={() => void setMeetingStatus("closed")}
                disabled={readOnly || saving || !selectedMeetingId || !meetingOpen || !allWorkflowStepsComplete || !minutesFinal || activeTab !== "review"}
                className="px-3 py-2 rounded-lg bg-rose-700 text-white text-xs disabled:opacity-50"
              >
                Close Meeting
              </button>
            </div>
            <div className="flex items-end">
              {meetingClosed ? (
                <span className="text-xs text-rose-700 font-medium">
                  Meeting is closed. Transactions are locked.
                </span>
              ) : selectedMeeting?.status === "scheduled" ? (
                <span className="text-xs text-amber-700 font-medium">Open the meeting to begin recording.</span>
              ) : null}
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 flex items-center justify-between gap-3">
            <p className="text-xs text-slate-600">
              Meeting minutes are managed on a dedicated page.
            </p>
            <button
              type="button"
              onClick={() => onNavigate?.(VSLA_PAGE.meetingMinutes)}
              className="px-3 py-2 rounded-lg bg-indigo-700 text-white text-xs"
            >
              Open Meeting Minutes
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-4">
        <div className="mb-4">
          <div className="flex items-center justify-between gap-2 overflow-x-auto pb-2">
          {workflowSteps.map((step, index) => {
            const complete = step.id === "review" ? allWorkflowStepsComplete : completedSteps.includes(step.id);
            return (
            <button
              key={step.id}
              type="button"
              onClick={() => setActiveTab(step.id)}
              disabled={!selectedMeetingId}
              className={`min-w-24 flex-1 rounded-lg border px-3 py-2 text-left text-xs ${activeTab === step.id ? "border-indigo-700 bg-indigo-700 text-white" : complete ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-600"}`}
            >
              <span className="flex items-center gap-1.5">{complete ? <Check className="w-3.5 h-3.5" /> : <Circle className="w-3.5 h-3.5" />}<span>{index + 1}. {step.label}</span></span>
            </button>
          )})}
          </div>
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${(completedSteps.filter((step) => step !== "review").length / 5) * 100}%` }} /></div>
        </div>

        {activeTab === "attendance" ? (
          <div className="space-y-3"><div className="rounded-lg bg-slate-50 px-3 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm text-slate-700"><span>Marked: <strong>{attendanceMarked}/{members.length}</strong> · Present: <strong>{presentCount}</strong> · Absent: <strong>{attendanceMarked - presentCount}</strong></span><span className="flex gap-2"><button type="button" onClick={() => void markAllAttendance(true)} disabled={!meetingOpen || readOnly || saving} className="rounded-md border border-emerald-300 bg-white px-2 py-1 text-xs text-emerald-700 disabled:opacity-50">All Present</button><button type="button" onClick={() => void markAllAttendance(false)} disabled={!meetingOpen || readOnly || saving} className="rounded-md border border-rose-300 bg-white px-2 py-1 text-xs text-rose-700 disabled:opacity-50">All Absent</button></span></div><div className="overflow-x-auto"><table className="w-full min-w-[480px] text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left p-3">Member</th>
                <th className="text-left p-3">Present</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="p-4 text-slate-500" colSpan={2}>
                    Loading attendance...
                  </td>
                </tr>
              ) : (
                members.map((m) => {
                  const attendanceEntry = attendanceMap.get(m.id);
                  const present = attendanceEntry?.present;
                  return (
                    <tr key={m.id} className="border-b border-slate-100">
                      <td className="p-3">{formatVslaMemberLabel(m)}</td>
                      <td className="p-3">
                        <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden"><button type="button" disabled={!selectedMeetingId || readOnly || !meetingOpen || saving} onClick={() => void markAttendance(m.id, true)} className={`px-3 py-1.5 text-xs ${present === true ? "bg-emerald-600 text-white" : "bg-white text-slate-600"}`}>Present</button><button type="button" disabled={!selectedMeetingId || readOnly || !meetingOpen || saving} onClick={() => void markAttendance(m.id, false)} className={`px-3 py-1.5 text-xs ${present === false ? "bg-rose-600 text-white" : "bg-white text-slate-600"}`}>Absent</button></div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table></div></div>
        ) : null}

        {activeTab === "savings" ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="p-3 rounded-lg bg-slate-50 text-sm">
                Share value:{" "}
                <strong>{Number(shareValue || 0).toLocaleString()}</strong>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 text-sm">
                Max stamps: <strong>{maxStamps}</strong>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 text-sm">
                Tap a stamp number per member (left stamps auto-highlight).
              </div>
            </div>
            <div className="space-y-2">
              {members.map((m) => {
                const selected = memberStampsMap.get(m.id) ?? 0;
                return (
                  <div
                    key={m.id}
                    className="border border-slate-200 rounded-lg p-3 flex flex-wrap items-center gap-3"
                  >
                    <div className="min-w-44 font-medium text-slate-800">
                      {formatVslaMemberLabel(m)}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {Array.from({ length: maxStamps }, (_, i) => i + 1).map(
                        (n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => void setMemberStamps(m.id, n)}
                            disabled={
                              !selectedMeetingId ||
                              readOnly ||
                               !meetingOpen ||
                              saving
                            }
                            className={`h-8 w-8 rounded-md text-xs font-semibold border ${
                              n <= selected
                                ? "bg-emerald-600 text-white border-emerald-700"
                                : "bg-white text-slate-700 border-slate-300"
                            } disabled:opacity-50`}
                            title={`${n} stamp${n > 1 ? "s" : ""}`}
                          >
                            {n}
                          </button>
                        ),
                      )}
                      <button
                        type="button"
                        onClick={() => void setMemberStamps(m.id, 0)}
                        disabled={
                          !selectedMeetingId ||
                          readOnly ||
                           !meetingOpen ||
                          saving
                        }
                        className="h-8 px-2 rounded-md text-xs font-medium border border-slate-300 text-slate-600 disabled:opacity-50"
                        title="Clear stamps"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="text-xs text-slate-600 ml-auto">
                      Stamps: <strong>{selected}</strong> | Value:{" "}
                      <strong>
                        {(selected * Number(shareValue || 0)).toLocaleString()}
                      </strong>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-sm text-slate-700">
              Meeting savings total:{" "}
              <strong>{savingsTotal.toLocaleString()}</strong>
            </p>
          </div>
        ) : null}

        {activeTab === "loans" ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Record the loan agreed by members during this meeting. It is disbursed immediately without a separate approval stage.</p>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <label className="text-xs text-slate-600">Member<select value={loanMemberId} onChange={(e) => setLoanMemberId(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"><option value="">Select member</option>{members.map((member) => <option key={member.id} value={member.id}>{formatVslaMemberLabel(member)}</option>)}</select></label>
              <label className="text-xs text-slate-600">Loan disbursed<input type="number" min="1" value={loanAmount} onChange={(e) => setLoanAmount(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
              <label className="text-xs text-slate-600">Period (months)<input type="number" min="1" step="1" value={loanPeriod} onChange={(e) => setLoanPeriod(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
              <label className="text-xs text-slate-600">Interest % / month<input type="number" min="0" step="0.01" value={loanInterest} onChange={(e) => setLoanInterest(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
              <div className="flex items-end"><button type="button" onClick={() => void recordMeetingLoan()} disabled={!meetingOpen || readOnly || saving || !loanMemberId} className="w-full px-4 py-2 rounded-lg bg-indigo-700 text-white text-sm disabled:opacity-50">Disburse Loan</button></div>
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-200"><table className="w-full min-w-[620px] text-sm"><thead className="bg-slate-50"><tr><th className="p-3 text-left">Member</th><th className="p-3 text-right">Loan disbursed</th><th className="p-3 text-right">Period</th><th className="p-3 text-right">Interest</th><th className="p-3 text-right">Balance</th></tr></thead><tbody>{loansForMeeting.map((loan) => <tr key={loan.id} className="border-t"><td className="p-3">{memberName.get(loan.member_id) ?? "Unknown"}</td><td className="p-3 text-right">{Number(loan.principal_amount).toLocaleString()}</td><td className="p-3 text-right">{loan.duration_meetings} months</td><td className="p-3 text-right">{loan.interest_rate_percent}%</td><td className="p-3 text-right font-semibold">{Number(loan.outstanding_balance).toLocaleString()}</td></tr>)}{!loansForMeeting.length && <tr><td colSpan={5} className="p-5 text-center text-slate-500">No loans disbursed in this meeting.</td></tr>}</tbody></table></div>
            <p className="text-sm text-slate-700">
              Loans issued in this meeting:{" "}
              <strong>{loansIssued.toLocaleString()}</strong>
            </p>
            <div className="overflow-x-auto rounded-lg border border-slate-200"><table className="w-full min-w-[620px] text-sm"><thead className="bg-slate-50"><tr><th className="p-3 text-left">Member</th><th className="p-3 text-right">Loan paid</th><th className="p-3 text-right">Interest paid</th><th className="p-3 text-right">Total paid</th><th className="p-3 text-right">Balance</th></tr></thead><tbody>{repaymentsForMeeting.map((repayment) => { const loan = loans.find((item) => item.id === repayment.loan_id); const total = Number(repayment.principal_paid)+Number(repayment.interest_paid)+Number(repayment.penalty_paid); return <tr key={repayment.id} className="border-t"><td className="p-3">{loan ? memberName.get(loan.member_id) ?? "Unknown" : "Unknown"}</td><td className="p-3 text-right">{Number(repayment.principal_paid).toLocaleString()}</td><td className="p-3 text-right">{Number(repayment.interest_paid).toLocaleString()}</td><td className="p-3 text-right font-semibold">{total.toLocaleString()}</td><td className="p-3 text-right">{Number(loan?.outstanding_balance || 0).toLocaleString()}</td></tr>; })}{!repaymentsForMeeting.length && <tr><td colSpan={5} className="p-5 text-center text-slate-500">No repayments recorded in this meeting.</td></tr>}</tbody></table></div>
          </div>
        ) : null}

        {activeTab === "repayments" ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <label className="text-xs text-slate-600">
                Loan
                <select
                  value={loanId}
                  onChange={(e) => setLoanId(e.target.value)}
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Select loan</option>
                  {loans
                    .filter(
                      (l) =>
                        l.status === "disbursed" && l.outstanding_balance > 0,
                    )
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {memberName.get(l.member_id) ?? "Unknown"} -{" "}
                        {Number(l.outstanding_balance || 0).toLocaleString()}
                      </option>
                    ))}
                </select>
              </label>
              <label className="text-xs text-slate-600">
                Principal
                <input
                  type="number"
                  value={principalPaid}
                  onChange={(e) => setPrincipalPaid(e.target.value)}
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </label>
              <label className="text-xs text-slate-600">
                Interest
                <input
                  type="number"
                  value={interestPaid}
                  onChange={(e) => setInterestPaid(e.target.value)}
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => void postRepayment()}
                   disabled={!selectedMeetingId || readOnly || !meetingOpen || saving}
                  className="px-4 py-2 rounded-lg bg-indigo-700 text-white text-sm disabled:opacity-50"
                >
                  Post Repayment
                </button>
              </div>
            </div>
            <p className="text-sm text-slate-700">
              Repayments in this meeting:{" "}
              <strong>{repaymentsTotal.toLocaleString()}</strong>
            </p>
          </div>
        ) : null}

        {activeTab === "cash" ? (
          <div className="space-y-3">
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 grid grid-cols-1 md:grid-cols-5 gap-3">
              <label className="text-xs text-slate-600 md:col-span-2">
                Member
                <select
                  value={txnMemberId}
                  onChange={(e) => setTxnMemberId(e.target.value)}
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Select member</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {formatVslaMemberLabel(m)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-600">
                Transaction
                <select
                  value={txnKind}
                  onChange={(e) => setTxnKind(e.target.value as TxnKind)}
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="fine">Fine</option>
                  <option value="social_payout">Social Payout</option>
                  <option value="chairman_basket">Chairman Basket</option>
                  <option value="refreshments">Refreshments</option>
                </select>
              </label>
              <label className="text-xs text-slate-600">
                Amount
                <input
                  type="number"
                  value={txnAmount}
                  onChange={(e) => setTxnAmount(e.target.value)}
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => void addMeetingTxn()}
                  disabled={
                     !selectedMeetingId || readOnly || !meetingOpen || saving
                  }
                  className="px-4 py-2 rounded-lg bg-indigo-700 text-white text-sm disabled:opacity-50"
                >
                  Post Txn
                </button>
              </div>
            </div>
            <div className="grid md:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-slate-100 text-sm">
                Savings inflow: <strong>{savingsTotal.toLocaleString()}</strong>
              </div>
              <div className="p-3 rounded-lg bg-slate-100 text-sm">
                Repayment inflow:{" "}
                <strong>{repaymentsTotal.toLocaleString()}</strong>
              </div>
              <div className="p-3 rounded-lg bg-slate-100 text-sm">
                Fines inflow: <strong>{finesTotal.toLocaleString()}</strong>
              </div>
              <div className="p-3 rounded-lg bg-slate-100 text-sm">
                Chairman basket inflow:{" "}
                <strong>{chairmanBasket.toLocaleString()}</strong>
              </div>
              <div className="p-3 rounded-lg bg-slate-100 text-sm">
                Loans outflow: <strong>{loansIssued.toLocaleString()}</strong>
              </div>
              <div className="p-3 rounded-lg bg-slate-100 text-sm">
                Social payouts:{" "}
                <strong>{socialPayouts.toLocaleString()}</strong>
              </div>
              <div className="p-3 rounded-lg bg-slate-100 text-sm">
                Refreshments outflow:{" "}
                <strong>{refreshments.toLocaleString()}</strong>
              </div>
              <div className="p-3 rounded-lg bg-indigo-100 text-indigo-800 text-sm md:col-span-2">
                Expected cash movement:{" "}
                <strong>
                  {(
                    savingsTotal +
                    repaymentsTotal +
                    finesTotal +
                    chairmanBasket -
                    loansIssued -
                    socialPayouts -
                    refreshments
                  ).toLocaleString()}
                </strong>
              </div>
            </div>
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 space-y-3">
              <div><p className="font-semibold text-indigo-950">Cash Reconciliation</p><p className="text-xs text-indigo-800">Count the physical cash before completing this step.</p></div>
              <div className="grid sm:grid-cols-4 gap-3">
                <label className="text-xs text-slate-600">Opening Cash<input type="number" min="0" value={openingCash} onChange={(event) => setOpeningCash(event.target.value)} disabled={!meetingOpen || readOnly || saving} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /></label>
                <div className="rounded-lg bg-white p-3 text-sm"><span className="text-xs text-slate-500">Expected Cash</span><p className="font-bold mt-1">{expectedCash.toLocaleString()}</p></div>
                <label className="text-xs text-slate-600">Physical Cash<input type="number" min="0" value={physicalCash} onChange={(event) => setPhysicalCash(event.target.value)} disabled={!meetingOpen || readOnly || saving} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /></label>
                <div className={`rounded-lg p-3 text-sm ${cashVariance === 0 ? "bg-emerald-100" : "bg-rose-100"}`}><span className="text-xs text-slate-600">Variance</span><p className="font-bold mt-1">{cashVariance.toLocaleString()}</p></div>
              </div>
              <button type="button" onClick={() => void saveCashReconciliation()} disabled={!meetingOpen || readOnly || saving} className="rounded-lg bg-indigo-700 px-4 py-2 text-sm text-white disabled:opacity-50">{saving ? "Saving..." : "Save Reconciliation & Complete Step"}</button>
            </div>
          </div>
        ) : null}

        {activeTab === "review" ? (
          <div className="space-y-4">
            <div className={`rounded-lg border p-4 ${allWorkflowStepsComplete && minutesFinal ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}><p className="font-semibold text-slate-900">{allWorkflowStepsComplete && minutesFinal ? "Meeting is ready to close" : !minutesFinal ? "Finalize the minutes before closing" : "Complete the remaining steps"}</p><p className="text-sm text-slate-700 mt-1">Closing locks meeting transactions and governance records.</p></div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-lg bg-slate-50 p-3 text-sm">Attendance<br /><strong>{presentCount}/{members.length} present</strong></div>
              <div className="rounded-lg bg-slate-50 p-3 text-sm">Savings<br /><strong>{savingsTotal.toLocaleString()}</strong></div>
              <div className="rounded-lg bg-slate-50 p-3 text-sm">Repayments<br /><strong>{repaymentsTotal.toLocaleString()}</strong></div>
              <div className="rounded-lg bg-slate-50 p-3 text-sm">Fines<br /><strong>{finesTotal.toLocaleString()}</strong></div>
              <div className="rounded-lg bg-slate-50 p-3 text-sm">Loans Issued<br /><strong>{loansIssued.toLocaleString()}</strong></div>
              <div className="rounded-lg bg-slate-50 p-3 text-sm">Social Payouts<br /><strong>{socialPayouts.toLocaleString()}</strong></div>
              <div className="rounded-lg bg-slate-50 p-3 text-sm">Chairman Basket<br /><strong>{chairmanBasket.toLocaleString()}</strong></div>
              <div className="rounded-lg bg-slate-50 p-3 text-sm">Refreshments<br /><strong>{refreshments.toLocaleString()}</strong></div>
            </div>
            <div className="flex flex-wrap gap-2"><button type="button" onClick={() => onNavigate?.(VSLA_PAGE.meetingMinutes)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm">{minutesFinal ? "Review Final Minutes" : "Complete & Finalize Minutes"}</button><button type="button" onClick={() => void setMeetingStatus("closed")} disabled={readOnly || saving || !meetingOpen || !allWorkflowStepsComplete || !minutesFinal} className="rounded-lg bg-rose-700 px-4 py-2 text-sm text-white disabled:opacity-50">{saving ? "Closing..." : "Close and Lock Meeting"}</button></div>
          </div>
        ) : null}

        {selectedMeetingId && activeTab !== "review" && <div className="mt-5 pt-4 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>{activeTab !== "cash" && <button type="button" onClick={() => void markStepComplete(activeTab)} disabled={readOnly || saving || !meetingOpen || completedSteps.includes(activeTab)} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-50">{completedSteps.includes(activeTab) ? "Step Complete" : saving ? "Saving..." : "Mark Step Complete"}</button>}</div>
          <div className="flex gap-2"><button type="button" onClick={() => setActiveTab(workflowSteps[Math.max(0, activeStepIndex - 1)].id)} disabled={activeStepIndex === 0} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40"><ChevronLeft className="w-4 h-4" />Previous</button><button type="button" onClick={() => setActiveTab(workflowSteps[Math.min(workflowSteps.length - 1, activeStepIndex + 1)].id)} disabled={!completedSteps.includes(activeTab)} className="inline-flex items-center gap-1 rounded-lg bg-indigo-700 px-3 py-2 text-sm text-white disabled:opacity-40">Next<ChevronRight className="w-4 h-4" /></button></div>
        </div>}
      </div>
    </div>
  );
}
