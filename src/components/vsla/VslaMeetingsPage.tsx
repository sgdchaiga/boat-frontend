import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";
import { VSLA_PAGE } from "@/lib/vslaPages";
import { formatVslaMemberLabel } from "@/lib/vslaMemberLabel";
import { computeVslaLoanOutstanding } from "@/lib/vslaLoanMath";

type MeetingStatus = "scheduled" | "open" | "closed";
type MeetingRow = {
  id: string;
  meeting_date: string;
  minutes: string | null;
  status: MeetingStatus;
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
  disbursed_on: string | null;
};
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [meetingDate, setMeetingDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [selectedMeetingId, setSelectedMeetingId] = useState("");
  const [activeTab, setActiveTab] = useState<
    "attendance" | "savings" | "loans" | "repayments" | "cash"
  >("attendance");
  const [txnMemberId, setTxnMemberId] = useState("");
  const [txnKind, setTxnKind] = useState<TxnKind>("loan_issue");
  const [txnAmount, setTxnAmount] = useState("0");
  const [txnNote, setTxnNote] = useState("");
  const [shareValue, setShareValue] = useState("2000");
  const [maxStamps, setMaxStamps] = useState(5);
  const [disburseLoanId, setDisburseLoanId] = useState("");
  const [loanId, setLoanId] = useState("");
  const [principalPaid, setPrincipalPaid] = useState("0");
  const [interestPaid, setInterestPaid] = useState("0");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const mq = filterByOrganizationId(
      supabase
        .from("vsla_meetings")
        .select("id,meeting_date,minutes,status")
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
          "id,member_id,status,outstanding_balance,principal_amount,interest_rate_percent,interest_type,disbursed_on",
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
    const [
      meetingsRes,
      membersRes,
      attendanceRes,
      loansRes,
      txRes,
      shareRes,
      settingsRes,
    ] = await Promise.all([mq, memQ, atQ, lnQ, txQ, shareQ, settingsQ]);
    if (
      meetingsRes.error ||
      membersRes.error ||
      attendanceRes.error ||
      loansRes.error ||
      txRes.error ||
      shareRes.error ||
      settingsRes.error
    ) {
      setError(
        meetingsRes.error?.message ??
          membersRes.error?.message ??
          attendanceRes.error?.message ??
          loansRes.error?.message ??
          txRes.error?.message ??
          shareRes.error?.message ??
          settingsRes.error?.message ??
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
      setDisburseLoanId(initialDisburseLoanId);
      setActiveTab("loans");
    }
  }, [initialDisburseLoanId, initialTab]);

  const selectedMeeting =
    meetings.find((m) => m.id === selectedMeetingId) ?? null;
  const meetingClosed = selectedMeeting?.status === "closed";

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

  const disburseApprovedLoan = async () => {
    if (readOnly || !selectedMeetingId || meetingClosed || !disburseLoanId)
      return;
    const loan = loans.find((l) => l.id === disburseLoanId);
    if (!loan || loan.status !== "approved") {
      setError("Selected loan must be approved before disbursement.");
      return;
    }
    setSaving(true);
    setError(null);
    const upd = await supabase
      .from("vsla_loans")
      .update({
        status: "disbursed",
        disbursed_on:
          selectedMeeting?.meeting_date ??
          new Date().toISOString().slice(0, 10),
      })
      .eq("id", loan.id);
    if (upd.error) {
      setError(upd.error.message);
      setSaving(false);
      return;
    }
    const ins = await supabase.from("vsla_meeting_transactions").insert({
      organization_id: orgId,
      meeting_id: selectedMeetingId,
      member_id: loan.member_id,
      kind: "loan_issue",
      amount: Number(loan.principal_amount || 0),
      note: `Loan disbursed in meeting (${loan.id})`,
    });
    if (ins.error) {
      setError(ins.error.message);
      setSaving(false);
      return;
    }
    setDisburseLoanId("");
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
    const del = await supabase
      .from("vsla_share_transactions")
      .delete()
      .eq("meeting_id", selectedMeetingId)
      .eq("member_id", memberId);
    if (del.error) {
      setError(del.error.message);
      setSaving(false);
      return;
    }
    if (stamps > 0) {
      const ins = await supabase.from("vsla_share_transactions").insert({
        organization_id: orgId,
        meeting_id: selectedMeetingId,
        member_id: memberId,
        shares_bought: stamps,
        share_value: value,
        total_value: stamps * value,
      });
      if (ins.error) {
        setError(ins.error.message);
        setSaving(false);
        return;
      }
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
    const today = new Date().toISOString().slice(0, 10);
    const ins = await supabase.from("vsla_loan_repayments").insert({
      organization_id: orgId,
      meeting_id: selectedMeetingId,
      loan_id: loanId,
      principal_paid: p,
      interest_paid: i,
      penalty_paid: 0,
      paid_on: today,
    });
    if (ins.error) {
      setError(ins.error.message);
      return;
    }
    const repays = await filterByOrganizationId(
      supabase
        .from("vsla_loan_repayments")
        .select("paid_on,principal_paid,interest_paid,penalty_paid")
        .eq("loan_id", loanId),
      orgId,
      superAdmin,
    );
    const calc = computeVslaLoanOutstanding(
      loan,
      (repays.data ?? []) as Array<{
        paid_on: string;
        principal_paid: number;
        interest_paid: number;
        penalty_paid: number;
      }>,
    );
    await supabase
      .from("vsla_loans")
      .update({
        outstanding_balance: calc.outstanding,
        total_due: calc.totalDue,
        status: calc.outstanding <= 0 ? "closed" : loan.status,
      })
      .eq("id", loanId);
    await supabase.from("vsla_meeting_transactions").insert({
      organization_id: orgId,
      meeting_id: selectedMeetingId,
      member_id: loan.member_id,
      kind: "loan_repayment",
      amount: p + i,
      note: "Repayment posted from meeting dashboard",
    });
    setPrincipalPaid("0");
    setInterestPaid("0");
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
                disabled={readOnly || saving || !selectedMeetingId}
                className="px-3 py-2 rounded-lg bg-emerald-700 text-white text-xs disabled:opacity-50"
              >
                Open
              </button>
              <button
                type="button"
                onClick={() => void setMeetingStatus("closed")}
                disabled={readOnly || saving || !selectedMeetingId}
                className="px-3 py-2 rounded-lg bg-rose-700 text-white text-xs disabled:opacity-50"
              >
                Close
              </button>
            </div>
            <div className="flex items-end">
              {meetingClosed ? (
                <span className="text-xs text-rose-700 font-medium">
                  Meeting is closed. Transactions are locked.
                </span>
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

      <div className="bg-white rounded-xl border border-slate-200 p-3">
        <div className="flex flex-wrap gap-2 mb-3">
          {[
            ["attendance", "Attendance"],
            ["savings", "Savings"],
            ["loans", "Loans"],
            ["repayments", "Repayments"],
            ["cash", "Cash Summary"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id as typeof activeTab)}
              className={`px-3 py-1.5 rounded-lg text-xs ${activeTab === id ? "bg-indigo-700 text-white" : "bg-slate-100 text-slate-700"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === "attendance" ? (
          <table className="w-full text-sm">
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
                  const present = !!attendanceMap.get(m.id)?.present;
                  return (
                    <tr key={m.id} className="border-b border-slate-100">
                      <td className="p-3">{formatVslaMemberLabel(m)}</td>
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={present}
                          disabled={
                            !selectedMeetingId || readOnly || meetingClosed
                          }
                          onChange={(e) =>
                            void markAttendance(m.id, e.target.checked)
                          }
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
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
                              meetingClosed ||
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
                          meetingClosed ||
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
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <label className="text-xs text-slate-600 md:col-span-2">
                Approved Loan To Disburse
                <select
                  value={disburseLoanId}
                  onChange={(e) => setDisburseLoanId(e.target.value)}
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Select approved loan</option>
                  {loans
                    .filter((l) => l.status === "approved")
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {memberName.get(l.member_id) ?? "Unknown"} -{" "}
                        {Number(l.principal_amount || 0).toLocaleString()}
                      </option>
                    ))}
                </select>
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => void disburseApprovedLoan()}
                  disabled={
                    !selectedMeetingId ||
                    readOnly ||
                    meetingClosed ||
                    saving ||
                    !disburseLoanId
                  }
                  className="px-4 py-2 rounded-lg bg-indigo-700 text-white text-sm disabled:opacity-50"
                >
                  Disburse Selected Loan
                </button>
              </div>
              <div className="text-xs text-slate-600 flex items-end">
                Loan details and approvals are managed in Loan Management.
              </div>
            </div>
            <p className="text-sm text-slate-700">
              Loans issued in this meeting:{" "}
              <strong>{loansIssued.toLocaleString()}</strong>
            </p>
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
                  disabled={!selectedMeetingId || readOnly || meetingClosed}
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
                    !selectedMeetingId || readOnly || meetingClosed || saving
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
          </div>
        ) : null}
      </div>
    </div>
  );
}
