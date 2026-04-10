import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";
import { formatVslaMemberLabel } from "@/lib/vslaMemberLabel";
import { computeVslaLoanOutstanding } from "@/lib/vslaLoanMath";

type FundTxn = {
  id: string;
  fund_type: "loan_fund" | "social_fund";
  txn_type: "contribution" | "payout";
  amount: number;
  reason: string | null;
  meeting_id: string | null;
  created_at: string;
};
type Fine = {
  id: string;
  member_id: string;
  fine_type: "late_coming" | "absenteeism" | "misconduct";
  amount: number;
  meeting_id: string | null;
  created_at: string;
};
type Member = { id: string; full_name: string; member_number: string | null };
type Meeting = { id: string; meeting_date: string; status: string };
type SocialFundLoan = {
  id: string;
  member_id: string;
  principal_amount: number;
  interest_rate_percent: number;
  interest_type: "flat" | "declining";
  interest_start_month: number;
  status: string;
  disbursed_on: string | null;
  outstanding_balance: number;
  total_due: number;
};
type WelfareStampRow = {
  id: string;
  meeting_id: string;
  member_id: string;
  stamps: number;
  stamp_value: number;
  total_value: number;
};

export function VslaFundsPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user, isSuperAdmin } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!isSuperAdmin;
  const [members, setMembers] = useState<Member[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [fines, setFines] = useState<Fine[]>([]);
  const [fundTxns, setFundTxns] = useState<FundTxn[]>([]);
  const [socialLoans, setSocialLoans] = useState<SocialFundLoan[]>([]);
  const [welfareStamps, setWelfareStamps] = useState<WelfareStampRow[]>([]);
  const [welfareStampValue, setWelfareStampValue] = useState(500);
  const [maxWelfareStamps, setMaxWelfareStamps] = useState(5);

  const [memberId, setMemberId] = useState("");
  const [meetingId, setMeetingId] = useState("");
  const [fineType, setFineType] = useState<Fine["fine_type"]>("late_coming");
  const [fineAmount, setFineAmount] = useState("0");
  const [fundType, setFundType] = useState<FundTxn["fund_type"]>("social_fund");
  const [txnType, setTxnType] = useState<FundTxn["txn_type"]>("contribution");
  const [fundAmount, setFundAmount] = useState("0");
  const [reason, setReason] = useState("");
  const [sfMemberId, setSfMemberId] = useState("");
  const [sfPrincipal, setSfPrincipal] = useState("0");
  const [sfRate, setSfRate] = useState("2");
  const [sfInterestStartMonth, setSfInterestStartMonth] = useState("2");
  const [sfRepayLoanId, setSfRepayLoanId] = useState("");
  const [sfRepayPrincipal, setSfRepayPrincipal] = useState("0");
  const [sfRepayInterest, setSfRepayInterest] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [editingFineId, setEditingFineId] = useState<string | null>(null);
  const [editFineAmount, setEditFineAmount] = useState("");
  const [editFineType, setEditFineType] =
    useState<Fine["fine_type"]>("late_coming");
  const [editFineMemberId, setEditFineMemberId] = useState("");
  const [editFineMeetingId, setEditFineMeetingId] = useState("");

  const [editingFundId, setEditingFundId] = useState<string | null>(null);
  const [editFundAmount, setEditFundAmount] = useState("");
  const [editFundType, setEditFundType] =
    useState<FundTxn["fund_type"]>("social_fund");
  const [editTxnType, setEditTxnType] =
    useState<FundTxn["txn_type"]>("contribution");
  const [editFundReason, setEditFundReason] = useState("");
  const [editFundMeetingId, setEditFundMeetingId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const settingsQ = filterByOrganizationId(
      supabase
        .from("vsla_settings")
        .select(
          "social_welfare_stamp_value,max_social_welfare_stamps_per_meeting",
        )
        .maybeSingle(),
      orgId,
      superAdmin,
    );
    const [mRes, mtRes, fRes, tRes, sfRes, wRes, sRes] = await Promise.all([
      filterByOrganizationId(
        supabase
          .from("vsla_members")
          .select("id,full_name,member_number")
          .order("full_name"),
        orgId,
        superAdmin,
      ),
      filterByOrganizationId(
        supabase
          .from("vsla_meetings")
          .select("id,meeting_date,status")
          .order("meeting_date", { ascending: false }),
        orgId,
        superAdmin,
      ),
      filterByOrganizationId(
        supabase.from("vsla_fines").select("*").order("created_at", {
          ascending: false,
        }),
        orgId,
        superAdmin,
      ),
      filterByOrganizationId(
        supabase.from("vsla_fund_transactions").select("*").order("created_at", {
          ascending: false,
        }),
        orgId,
        superAdmin,
      ),
      filterByOrganizationId(
        supabase
          .from("vsla_social_fund_loans")
          .select("*")
          .order("created_at", { ascending: false }),
        orgId,
        superAdmin,
      ),
      filterByOrganizationId(
        supabase
          .from("vsla_social_welfare_stamps")
          .select("*")
          .order("created_at", { ascending: false }),
        orgId,
        superAdmin,
      ),
      settingsQ,
    ]);
    if (sRes.data) {
      const row = sRes.data as {
        social_welfare_stamp_value?: number;
        max_social_welfare_stamps_per_meeting?: number;
      };
      if (row.social_welfare_stamp_value != null)
        setWelfareStampValue(Number(row.social_welfare_stamp_value));
      if (row.max_social_welfare_stamps_per_meeting != null)
        setMaxWelfareStamps(Number(row.max_social_welfare_stamps_per_meeting));
    }
    setMembers((mRes.data ?? []) as Member[]);
    const meetingsData = (mtRes.data ?? []) as Meeting[];
    setMeetings(meetingsData);
    if (!meetingId && meetingsData[0]?.id) setMeetingId(meetingsData[0].id);
    setFines((fRes.data ?? []) as Fine[]);
    setFundTxns((tRes.data ?? []) as FundTxn[]);
    setSocialLoans((sfRes.data ?? []) as SocialFundLoan[]);
    setWelfareStamps((wRes.data ?? []) as WelfareStampRow[]);
    setError(
      mRes.error?.message ??
        mtRes.error?.message ??
        fRes.error?.message ??
        tRes.error?.message ??
        sfRes.error?.message ??
        wRes.error?.message ??
        sRes.error?.message ??
        null,
    );
    setLoading(false);
  }, [meetingId, orgId, superAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const memberPlain = useMemo(
    () =>
      new Map(
        members.map((m) => [
          m.id,
          (m.full_name ?? "").trim() || "Unknown",
        ]),
      ),
    [members],
  );
  const memberNo = useMemo(
    () =>
      new Map(
        members.map((m) => [
          m.id,
          (m.member_number ?? "").trim() || "—",
        ]),
      ),
    [members],
  );
  const meetingDate = useMemo(
    () => new Map(meetings.map((m) => [m.id, m.meeting_date])),
    [meetings],
  );

  const welfareByMeetingMember = useMemo(() => {
    const map = new Map<string, number>();
    for (const w of welfareStamps) {
      const key = `${w.meeting_id}:${w.member_id}`;
      map.set(key, Number(w.stamps || 0));
    }
    return map;
  }, [welfareStamps]);

  const saveWelfareSettings = async () => {
    if (readOnly) return;
    setSaving(true);
    setError(null);
    const base = await filterByOrganizationId(
      supabase
        .from("vsla_settings")
        .select("share_value,max_shares_per_meeting")
        .maybeSingle(),
      orgId,
      superAdmin,
    );
    const share = Number((base.data as { share_value?: number })?.share_value ?? 2000);
    const maxS = Number(
      (base.data as { max_shares_per_meeting?: number })
        ?.max_shares_per_meeting ?? 5,
    );
    const { error: e } = await supabase.from("vsla_settings").upsert(
      {
        organization_id: orgId,
        share_value: share,
        max_shares_per_meeting: maxS,
        social_welfare_stamp_value: Number(welfareStampValue || 0),
        max_social_welfare_stamps_per_meeting: Number(maxWelfareStamps || 0),
      },
      { onConflict: "organization_id" },
    );
    if (e) setError(e.message);
    setSaving(false);
    await load();
  };

  const setWelfareMemberStamps = async (
    targetMemberId: string,
    stamps: number,
  ) => {
    if (readOnly || !meetingId) return;
    const value = Number(welfareStampValue || 0);
    const maxS = Math.max(1, Number(maxWelfareStamps || 5));
    if (!targetMemberId || value <= 0) return;
    if (stamps > maxS) {
      setError(`Max welfare stamps per meeting is ${maxS}.`);
      return;
    }
    setSaving(true);
    setError(null);
    await supabase
      .from("vsla_social_welfare_stamps")
      .delete()
      .eq("meeting_id", meetingId)
      .eq("member_id", targetMemberId);
    if (stamps > 0) {
      const ins = await supabase.from("vsla_social_welfare_stamps").insert({
        organization_id: orgId,
        meeting_id: meetingId,
        member_id: targetMemberId,
        stamps,
        stamp_value: value,
        total_value: stamps * value,
      });
      if (ins.error) setError(ins.error.message);
    }
    setSaving(false);
    await load();
  };

  const postFine = async () => {
    if (readOnly) return;
    setError(null);
    setSuccessMsg(null);
    const amount = Number(fineAmount || 0);
    if (!meetingId || !memberId || amount <= 0)
      return setError("Meeting, member, and fine amount are required.");
    const { error: e } = await supabase.from("vsla_fines").insert({
      organization_id: orgId,
      meeting_id: meetingId,
      member_id: memberId,
      fine_type: fineType,
      amount,
    });
    if (e) return setError(e.message);
    setFineAmount("0");
    setSuccessMsg("Fine posted.");
    await load();
  };

  const postFundTxn = async () => {
    if (readOnly) return;
    setError(null);
    setSuccessMsg(null);
    const amount = Number(fundAmount || 0);
    if (!meetingId || amount <= 0)
      return setError("Meeting and amount are required.");
    const { error: e } = await supabase.from("vsla_fund_transactions").insert({
      organization_id: orgId,
      meeting_id: meetingId,
      fund_type: fundType,
      txn_type: txnType,
      amount,
      reason: reason.trim() || null,
    });
    if (e) return setError(e.message);
    setFundAmount("0");
    setReason("");
    setSuccessMsg("Fund transaction posted.");
    await load();
  };

  const saveFineEdit = async (id: string) => {
    if (readOnly) return;
    const amount = Number(editFineAmount || 0);
    if (!editFineMeetingId || !editFineMemberId || amount <= 0) return;
    setSaving(true);
    const { error: e } = await supabase
      .from("vsla_fines")
      .update({
        fine_type: editFineType,
        amount,
        member_id: editFineMemberId,
        meeting_id: editFineMeetingId,
      })
      .eq("id", id);
    if (e) setError(e.message);
    setEditingFineId(null);
    setSaving(false);
    await load();
  };

  const deleteFine = async (id: string) => {
    if (readOnly) return;
    if (!confirm("Delete this fine?")) return;
    setSaving(true);
    const { error: e } = await supabase.from("vsla_fines").delete().eq("id", id);
    if (e) setError(e.message);
    setSaving(false);
    await load();
  };

  const saveFundEdit = async (id: string) => {
    if (readOnly) return;
    const amount = Number(editFundAmount || 0);
    if (!editFundMeetingId || amount <= 0) return;
    setSaving(true);
    const { error: e } = await supabase
      .from("vsla_fund_transactions")
      .update({
        fund_type: editFundType,
        txn_type: editTxnType,
        amount,
        reason: editFundReason.trim() || null,
        meeting_id: editFundMeetingId,
      })
      .eq("id", id);
    if (e) setError(e.message);
    setEditingFundId(null);
    setSaving(false);
    await load();
  };

  const deleteFundTxn = async (id: string) => {
    if (readOnly) return;
    if (!confirm("Delete this fund transaction?")) return;
    setSaving(true);
    const { error: e } = await supabase
      .from("vsla_fund_transactions")
      .delete()
      .eq("id", id);
    if (e) setError(e.message);
    setSaving(false);
    await load();
  };

  const createSocialFundLoan = async () => {
    if (readOnly) return;
    const principal = Number(sfPrincipal || 0);
    const rate = Number(sfRate || 0);
    const startMonth = Number(sfInterestStartMonth || 1);
    if (!meetingId || !sfMemberId || principal <= 0 || startMonth < 1)
      return setError(
        "Meeting, member, principal and interest start month are required.",
      );
    const disbursedOn =
      meetingDate.get(meetingId) ?? new Date().toISOString().slice(0, 10);
    const { error: e } = await supabase.from("vsla_social_fund_loans").insert({
      organization_id: orgId,
      meeting_id: meetingId,
      member_id: sfMemberId,
      principal_amount: principal,
      interest_rate_percent: rate,
      interest_type: "flat",
      interest_start_month: startMonth,
      disbursed_on: disbursedOn,
      status: "disbursed",
      total_due: principal,
      outstanding_balance: principal,
    });
    if (e) return setError(e.message);
    setSfPrincipal("0");
    setSfRate("2");
    setSfInterestStartMonth("2");
    await load();
  };

  const repaySocialFundLoan = async () => {
    if (readOnly) return;
    const loan = socialLoans.find((l) => l.id === sfRepayLoanId);
    if (!loan) return;
    const principalPaid = Number(sfRepayPrincipal || 0);
    const interestPaid = Number(sfRepayInterest || 0);
    if (principalPaid + interestPaid <= 0) return;
    const paidOn = new Date().toISOString().slice(0, 10);
    const ins = await supabase.from("vsla_social_fund_loan_repayments").insert({
      organization_id: orgId,
      social_fund_loan_id: loan.id,
      meeting_id: meetingId || null,
      principal_paid: principalPaid,
      interest_paid: interestPaid,
      penalty_paid: 0,
      paid_on: paidOn,
    });
    if (ins.error) return setError(ins.error.message);
    const repays = await filterByOrganizationId(
      supabase
        .from("vsla_social_fund_loan_repayments")
        .select("paid_on,principal_paid,interest_paid,penalty_paid")
        .eq("social_fund_loan_id", loan.id),
      orgId,
      superAdmin,
    );
    const shiftedLoan = {
      principal_amount: loan.principal_amount,
      interest_rate_percent: loan.interest_rate_percent,
      interest_type: loan.interest_type,
      disbursed_on: loan.disbursed_on,
    };
    const calc = computeVslaLoanOutstanding(
      shiftedLoan,
      (repays.data ?? []) as Array<{
        paid_on: string;
        principal_paid: number;
        interest_paid: number;
        penalty_paid: number;
      }>,
    );
    const startMonth = Math.max(1, Number(loan.interest_start_month || 1));
    const monthlyGrace =
      loan.disbursed_on && startMonth > 1
        ? new Date(
            new Date(`${loan.disbursed_on}T00:00:00`).getFullYear(),
            new Date(`${loan.disbursed_on}T00:00:00`).getMonth() +
              (startMonth - 1),
            new Date(`${loan.disbursed_on}T00:00:00`).getDate(),
          )
        : null;
    const effectiveOutstanding =
      monthlyGrace && new Date() < monthlyGrace
        ? Math.max(
            0,
            Number(loan.principal_amount || 0) -
              (repays.data ?? []).reduce(
                (s, r) =>
                  s +
                  Number(
                    (r as { principal_paid?: number }).principal_paid || 0,
                  ),
                0,
              ),
          )
        : calc.outstanding;
    await supabase
      .from("vsla_social_fund_loans")
      .update({
        outstanding_balance: effectiveOutstanding,
        total_due: calc.totalDue,
        status: effectiveOutstanding <= 0 ? "closed" : loan.status,
      })
      .eq("id", loan.id);
    setSfRepayPrincipal("0");
    setSfRepayInterest("0");
    await load();
  };

  const socialFromFunds = fundTxns
    .filter((x) => x.fund_type === "social_fund")
    .reduce(
      (s, x) => s + (x.txn_type === "contribution" ? x.amount : -x.amount),
      0,
    );
  const welfareStampTotal = welfareStamps.reduce(
    (s, x) => s + Number(x.total_value || 0),
    0,
  );
  const socialFundBal = socialFromFunds + welfareStampTotal;
  const loanFundBal = fundTxns
    .filter((x) => x.fund_type === "loan_fund")
    .reduce(
      (s, x) => s + (x.txn_type === "contribution" ? x.amount : -x.amount),
      0,
    );

  const maxW = Math.max(1, maxWelfareStamps);

  return (
    <div className="px-4 py-6 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {readOnly && <ReadOnlyNotice />}
      <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
        VSLA Fines & Social Fund
      </h1>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {successMsg && <p className="text-sm text-emerald-700">{successMsg}</p>}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <label className="text-xs text-slate-600">
          Meeting
          <select
            value={meetingId}
            onChange={(e) => setMeetingId(e.target.value)}
            className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm"
          >
            <option value="">Select meeting</option>
            {meetings.map((m) => (
              <option key={m.id} value={m.id}>
                {m.meeting_date} ({m.status})
              </option>
            ))}
          </select>
        </label>
        <div className="p-3 rounded-lg bg-slate-100 text-sm">
          Loan Fund Balance: <strong>{loanFundBal.toLocaleString()}</strong>
        </div>
        <div className="p-3 rounded-lg bg-slate-100 text-sm">
          Social Fund Balance: <strong>{socialFundBal.toLocaleString()}</strong>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Social welfare stamps (settings)
        </p>
        <div className="grid sm:grid-cols-3 gap-3">
          <label className="text-xs text-slate-600">
            Welfare stamp value
            <input
              type="number"
              value={welfareStampValue}
              onChange={(e) =>
                setWelfareStampValue(Number(e.target.value || 0))
              }
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm"
            />
          </label>
          <label className="text-xs text-slate-600">
            Max stamps / meeting
            <input
              type="number"
              min={1}
              value={maxWelfareStamps}
              onChange={(e) =>
                setMaxWelfareStamps(Number(e.target.value || 1))
              }
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm"
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              disabled={readOnly || saving}
              onClick={() => void saveWelfareSettings()}
              className="min-h-[44px] w-full sm:w-auto px-4 py-2 rounded-lg bg-slate-900 text-white text-sm touch-manipulation disabled:opacity-50"
            >
              Save welfare settings
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Social welfare stamps (per member)
        </p>
        {!meetingId ? (
          <p className="text-sm text-slate-500">Select a meeting.</p>
        ) : (
          <div className="space-y-2">
            {members.map((m) => {
              const key = `${meetingId}:${m.id}`;
              const selected = welfareByMeetingMember.get(key) ?? 0;
              return (
                <div
                  key={m.id}
                  className="border border-slate-200 rounded-lg p-3 flex flex-wrap items-center gap-2"
                >
                  <div className="min-w-[10rem] text-sm font-medium text-slate-800">
                    {formatVslaMemberLabel(m)}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from({ length: maxW }, (_, i) => i + 1).map((n) => (
                      <button
                        key={n}
                        type="button"
                        disabled={readOnly || saving}
                        onClick={() => void setWelfareMemberStamps(m.id, n)}
                        className={`min-h-[44px] min-w-[44px] rounded-md text-xs font-semibold border touch-manipulation ${
                          n <= selected
                            ? "bg-teal-600 text-white border-teal-700"
                            : "bg-white text-slate-700 border-slate-300"
                        } disabled:opacity-50`}
                      >
                        {n}
                      </button>
                    ))}
                    <button
                      type="button"
                      disabled={readOnly || saving}
                      onClick={() => void setWelfareMemberStamps(m.id, 0)}
                      className="min-h-[44px] px-3 rounded-md text-xs border touch-manipulation disabled:opacity-50"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="text-xs text-slate-600 ml-auto">
                    Stamps: <strong>{selected}</strong> ·{" "}
                    <strong>
                      {(selected * Number(welfareStampValue || 0)).toLocaleString()}
                    </strong>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Record Fine (meeting linked)
          </p>
          <select
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm"
          >
            <option value="">Select member</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {formatVslaMemberLabel(m)}
              </option>
            ))}
          </select>
          <select
            value={fineType}
            onChange={(e) => setFineType(e.target.value as Fine["fine_type"])}
            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm"
          >
            <option value="late_coming">Late Coming</option>
            <option value="absenteeism">Absenteeism</option>
            <option value="misconduct">Misconduct</option>
          </select>
          <input
            type="number"
            value={fineAmount}
            onChange={(e) => setFineAmount(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm"
          />
          <button
            type="button"
            className="min-h-[44px] px-4 py-2 bg-indigo-700 text-white rounded-lg text-sm touch-manipulation"
            disabled={readOnly}
            onClick={() => void postFine()}
          >
            Post Fine
          </button>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Social/Loan Fund Transaction (meeting linked)
          </p>
          <select
            value={fundType}
            onChange={(e) =>
              setFundType(e.target.value as FundTxn["fund_type"])
            }
            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm"
          >
            <option value="social_fund">Social Fund</option>
            <option value="loan_fund">Loan Fund</option>
          </select>
          <select
            value={txnType}
            onChange={(e) => setTxnType(e.target.value as FundTxn["txn_type"])}
            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm"
          >
            <option value="contribution">Contribution</option>
            <option value="payout">Payout</option>
          </select>
          <input
            type="number"
            value={fundAmount}
            onChange={(e) => setFundAmount(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm"
          />
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason"
            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm"
          />
          <button
            type="button"
            className="min-h-[44px] px-4 py-2 bg-indigo-700 text-white rounded-lg text-sm touch-manipulation"
            disabled={readOnly}
            onClick={() => void postFundTxn()}
          >
            Post Transaction
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Social Fund Loans
        </p>
        <div className="grid md:grid-cols-6 gap-3">
          <label className="text-xs text-slate-600 md:col-span-2">
            Member
            <select
              value={sfMemberId}
              onChange={(e) => setSfMemberId(e.target.value)}
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
            Principal
            <input
              type="number"
              value={sfPrincipal}
              onChange={(e) => setSfPrincipal(e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs text-slate-600">
            Interest %/month
            <input
              type="number"
              value={sfRate}
              onChange={(e) => setSfRate(e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs text-slate-600">
            Interest starts at month
            <input
              type="number"
              min={1}
              value={sfInterestStartMonth}
              onChange={(e) => setSfInterestStartMonth(e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => void createSocialFundLoan()}
              disabled={readOnly}
              className="min-h-[44px] px-4 py-2 rounded-lg bg-indigo-700 text-white text-sm touch-manipulation"
            >
              Create Loan
            </button>
          </div>
        </div>
        <div className="grid md:grid-cols-5 gap-3">
          <label className="text-xs text-slate-600 md:col-span-2">
            Repay Loan
            <select
              value={sfRepayLoanId}
              onChange={(e) => setSfRepayLoanId(e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Select social fund loan</option>
              {socialLoans
                .filter(
                  (l) => l.status === "disbursed" && l.outstanding_balance > 0,
                )
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {memberPlain.get(l.member_id) ?? "Unknown"} (
                    {memberNo.get(l.member_id) ?? "—"}) — Balance{" "}
                    {Number(l.outstanding_balance || 0).toLocaleString()}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Principal
            <input
              type="number"
              value={sfRepayPrincipal}
              onChange={(e) => setSfRepayPrincipal(e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs text-slate-600">
            Interest
            <input
              type="number"
              value={sfRepayInterest}
              onChange={(e) => setSfRepayInterest(e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => void repaySocialFundLoan()}
              disabled={readOnly}
              className="min-h-[44px] px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm touch-manipulation"
            >
              Post Repayment
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <p className="p-3 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b">
          Fines (edit / delete)
        </p>
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="text-left p-3">Type</th>
              <th className="text-left p-3">Member</th>
              <th className="text-left p-3">No.</th>
              <th className="text-left p-3">Amount</th>
              <th className="text-left p-3">Meeting</th>
              <th className="text-left p-3">Date</th>
              <th className="text-left p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="p-4 text-slate-500">
                  Loading...
                </td>
              </tr>
            ) : (
              fines.map((f) => (
                <tr key={f.id} className="border-b border-slate-100">
                  {editingFineId === f.id ? (
                    <>
                      <td className="p-2">
                        <select
                          value={editFineType}
                          onChange={(e) =>
                            setEditFineType(e.target.value as Fine["fine_type"])
                          }
                          className="w-full border rounded px-2 py-1.5 text-sm"
                        >
                          <option value="late_coming">Late Coming</option>
                          <option value="absenteeism">Absenteeism</option>
                          <option value="misconduct">Misconduct</option>
                        </select>
                      </td>
                      <td className="p-2" colSpan={2}>
                        <select
                          value={editFineMemberId}
                          onChange={(e) => setEditFineMemberId(e.target.value)}
                          className="w-full border rounded px-2 py-1.5 text-sm"
                        >
                          {members.map((m) => (
                            <option key={m.id} value={m.id}>
                              {formatVslaMemberLabel(m)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          value={editFineAmount}
                          onChange={(e) => setEditFineAmount(e.target.value)}
                          className="w-24 border rounded px-2 py-1.5"
                        />
                      </td>
                      <td className="p-2" colSpan={2}>
                        <select
                          value={editFineMeetingId}
                          onChange={(e) => setEditFineMeetingId(e.target.value)}
                          className="w-full border rounded px-2 py-1.5 text-sm"
                        >
                          {meetings.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.meeting_date}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2">
                        <button
                          type="button"
                          className="text-xs text-indigo-700 mr-2"
                          disabled={readOnly || saving}
                          onClick={() => void saveFineEdit(f.id)}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="text-xs text-slate-600"
                          onClick={() => setEditingFineId(null)}
                        >
                          Cancel
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="p-3">{f.fine_type}</td>
                      <td className="p-3">
                        {memberPlain.get(f.member_id) ?? "Unknown"}
                      </td>
                      <td className="p-3 text-slate-600">
                        {memberNo.get(f.member_id) ?? "—"}
                      </td>
                      <td className="p-3">
                        {Number(f.amount || 0).toLocaleString()}
                      </td>
                      <td className="p-3">
                        {f.meeting_id
                          ? (meetingDate.get(f.meeting_id) ??
                            f.meeting_id.slice(0, 8))
                          : "—"}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        {String(f.created_at).slice(0, 10)}
                      </td>
                      <td className="p-3">
                        <button
                          type="button"
                          className="text-xs text-indigo-700 mr-2 touch-manipulation"
                          disabled={readOnly || saving}
                          onClick={() => {
                            setEditingFineId(f.id);
                            setEditFineAmount(String(f.amount));
                            setEditFineType(f.fine_type);
                            setEditFineMemberId(f.member_id);
                            setEditFineMeetingId(f.meeting_id ?? meetingId);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="text-xs text-rose-700 touch-manipulation"
                          disabled={readOnly || saving}
                          onClick={() => void deleteFine(f.id)}
                        >
                          Delete
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <p className="p-3 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b">
          Fund transactions (edit / delete)
        </p>
        <table className="w-full text-sm min-w-[800px]">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="text-left p-3">Fund</th>
              <th className="text-left p-3">Type</th>
              <th className="text-left p-3">Amount</th>
              <th className="text-left p-3">Meeting</th>
              <th className="text-left p-3">Reason</th>
              <th className="text-left p-3">Date</th>
              <th className="text-left p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="p-4 text-slate-500">
                  Loading...
                </td>
              </tr>
            ) : (
              fundTxns.map((t) => (
                <tr key={t.id} className="border-b border-slate-100">
                  {editingFundId === t.id ? (
                    <>
                      <td className="p-2">
                        <select
                          value={editFundType}
                          onChange={(e) =>
                            setEditFundType(e.target.value as FundTxn["fund_type"])
                          }
                          className="w-full border rounded px-2 py-1 text-sm"
                        >
                          <option value="social_fund">Social</option>
                          <option value="loan_fund">Loan</option>
                        </select>
                      </td>
                      <td className="p-2">
                        <select
                          value={editTxnType}
                          onChange={(e) =>
                            setEditTxnType(e.target.value as FundTxn["txn_type"])
                          }
                          className="w-full border rounded px-2 py-1 text-sm"
                        >
                          <option value="contribution">Contribution</option>
                          <option value="payout">Payout</option>
                        </select>
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          value={editFundAmount}
                          onChange={(e) => setEditFundAmount(e.target.value)}
                          className="w-24 border rounded px-2 py-1"
                        />
                      </td>
                      <td className="p-2">
                        <select
                          value={editFundMeetingId}
                          onChange={(e) => setEditFundMeetingId(e.target.value)}
                          className="w-full border rounded px-2 py-1 text-sm"
                        >
                          {meetings.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.meeting_date}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2">
                        <input
                          value={editFundReason}
                          onChange={(e) => setEditFundReason(e.target.value)}
                          className="w-full border rounded px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="p-2 text-xs text-slate-500">
                        {String(t.created_at).slice(0, 10)}
                      </td>
                      <td className="p-2">
                        <button
                          type="button"
                          className="text-xs text-indigo-700 mr-2"
                          disabled={readOnly || saving}
                          onClick={() => void saveFundEdit(t.id)}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="text-xs text-slate-600"
                          onClick={() => setEditingFundId(null)}
                        >
                          Cancel
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="p-3">{t.fund_type}</td>
                      <td className="p-3">{t.txn_type}</td>
                      <td className="p-3">
                        {Number(t.amount || 0).toLocaleString()}
                      </td>
                      <td className="p-3">
                        {t.meeting_id
                          ? (meetingDate.get(t.meeting_id) ??
                            t.meeting_id.slice(0, 8))
                          : "—"}
                      </td>
                      <td className="p-3 max-w-[200px] truncate">
                        {t.reason ?? "—"}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        {String(t.created_at).slice(0, 10)}
                      </td>
                      <td className="p-3">
                        <button
                          type="button"
                          className="text-xs text-indigo-700 mr-2 touch-manipulation"
                          disabled={readOnly || saving}
                          onClick={() => {
                            setEditingFundId(t.id);
                            setEditFundAmount(String(t.amount));
                            setEditFundType(t.fund_type);
                            setEditTxnType(t.txn_type);
                            setEditFundReason(t.reason ?? "");
                            setEditFundMeetingId(t.meeting_id ?? meetingId);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="text-xs text-rose-700 touch-manipulation"
                          disabled={readOnly || saving}
                          onClick={() => void deleteFundTxn(t.id)}
                        >
                          Delete
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
