import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";

type CashRow = {
  id: string;
  meeting_id: string;
  opening_cash: number;
  physical_cash: number | null;
  inflow_savings: number;
  inflow_repayments: number;
  inflow_fines: number;
  outflow_loans: number;
  outflow_social_payouts: number;
  created_at: string;
};
type MeetingRow = { id: string; meeting_date: string; status: "scheduled" | "open" | "closed" };
type ShareTxnRow = { meeting_id: string | null; total_value: number };
type RepaymentRow = { meeting_id: string | null; principal_paid: number; interest_paid: number; penalty_paid: number };
type FineRow = { meeting_id: string | null; amount: number };
type MeetingTxnRow = { meeting_id: string | null; kind: "loan_issue" | "loan_repayment" | "fine" | "social_payout"; amount: number };
type FundTxnRow = { meeting_id: string | null; fund_type: "loan_fund" | "social_fund"; txn_type: "contribution" | "payout"; amount: number };
type LoanRow = { principal_amount: number; status: "applied" | "approved" | "disbursed" | "closed" | "defaulted"; applied_at: string };

export function VslaCashboxPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user, isSuperAdmin } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!isSuperAdmin;
  const [rows, setRows] = useState<CashRow[]>([]);
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [shareTxns, setShareTxns] = useState<ShareTxnRow[]>([]);
  const [repayments, setRepayments] = useState<RepaymentRow[]>([]);
  const [fines, setFines] = useState<FineRow[]>([]);
  const [meetingTxns, setMeetingTxns] = useState<MeetingTxnRow[]>([]);
  const [fundTxns, setFundTxns] = useState<FundTxnRow[]>([]);
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [meetingId, setMeetingId] = useState("");
  const [openingCash, setOpeningCash] = useState("0");
  const [physicalCash, setPhysicalCash] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [cashRes, meetingsRes, shareRes, repayRes, finesRes, meetingTxnRes, fundTxnRes, loansRes] = await Promise.all([
      filterByOrganizationId(
        supabase.from("vsla_cashbox_snapshots").select("*").order("created_at", { ascending: false }),
        orgId,
        superAdmin
      ),
      filterByOrganizationId(
        supabase.from("vsla_meetings").select("id,meeting_date,status").order("meeting_date", { ascending: false }),
        orgId,
        superAdmin
      ),
      filterByOrganizationId(
        supabase.from("vsla_share_transactions").select("meeting_id,total_value"),
        orgId,
        superAdmin
      ),
      filterByOrganizationId(
        supabase.from("vsla_loan_repayments").select("meeting_id,principal_paid,interest_paid,penalty_paid"),
        orgId,
        superAdmin
      ),
      filterByOrganizationId(
        supabase.from("vsla_fines").select("meeting_id,amount"),
        orgId,
        superAdmin
      ),
      filterByOrganizationId(
        supabase.from("vsla_meeting_transactions").select("meeting_id,kind,amount"),
        orgId,
        superAdmin
      ),
      filterByOrganizationId(
        supabase.from("vsla_fund_transactions").select("meeting_id,fund_type,txn_type,amount"),
        orgId,
        superAdmin
      ),
      filterByOrganizationId(
        supabase.from("vsla_loans").select("principal_amount,status,applied_at"),
        orgId,
        superAdmin
      ),
    ]);
    setRows((cashRes.data ?? []) as CashRow[]);
    const meetingsData = (meetingsRes.data ?? []) as MeetingRow[];
    setMeetings(meetingsData);
    setShareTxns((shareRes.data ?? []) as ShareTxnRow[]);
    setRepayments((repayRes.data ?? []) as RepaymentRow[]);
    setFines((finesRes.data ?? []) as FineRow[]);
    setMeetingTxns((meetingTxnRes.data ?? []) as MeetingTxnRow[]);
    setFundTxns((fundTxnRes.data ?? []) as FundTxnRow[]);
    setLoans((loansRes.data ?? []) as LoanRow[]);
    setError(
      cashRes.error?.message ??
        meetingsRes.error?.message ??
        shareRes.error?.message ??
        repayRes.error?.message ??
        finesRes.error?.message ??
        meetingTxnRes.error?.message ??
        fundTxnRes.error?.message ??
        loansRes.error?.message ??
        null
    );
    if (!meetingId && meetingsData[0]?.id) setMeetingId(meetingsData[0].id);
  }, [meetingId, orgId, superAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const computeByMeeting = useCallback(
    (targetMeetingId: string | null | undefined) => {
      if (!targetMeetingId) {
        return {
          inflowSavings: 0,
          inflowRepayments: 0,
          inflowFines: 0,
          outflowLoans: 0,
          outflowSocialPayouts: 0,
        };
      }
      const inflowSavings = shareTxns
        .filter((r) => r.meeting_id === targetMeetingId)
        .reduce((s, r) => s + Number(r.total_value || 0), 0);
      const inflowRepayments = repayments
        .filter((r) => r.meeting_id === targetMeetingId)
        .reduce((s, r) => s + Number(r.principal_paid || 0) + Number(r.interest_paid || 0) + Number(r.penalty_paid || 0), 0);
      const inflowFinesFromFinesTable = fines
        .filter((r) => r.meeting_id === targetMeetingId)
        .reduce((s, r) => s + Number(r.amount || 0), 0);
      const inflowFinesFromMeetingTxns = meetingTxns
        .filter((r) => r.meeting_id === targetMeetingId && r.kind === "fine")
        .reduce((s, r) => s + Number(r.amount || 0), 0);
      const outflowLoans = meetingTxns
        .filter((r) => r.meeting_id === targetMeetingId && r.kind === "loan_issue")
        .reduce((s, r) => s + Number(r.amount || 0), 0);
      // Fallback path: loans disbursed from loan management page may not create meeting_txn rows.
      // Map disbursed loans by meeting date so cashbox still reflects issued cash.
      const meetingDate = meetings.find((m) => m.id === targetMeetingId)?.meeting_date ?? null;
      const outflowLoansFromDisbursedLoans =
        meetingDate == null
          ? 0
          : loans
              .filter((l) => l.status === "disbursed" && String(l.applied_at).slice(0, 10) === meetingDate)
              .reduce((s, l) => s + Number(l.principal_amount || 0), 0);
      const outflowSocialFromMeetingTxns = meetingTxns
        .filter((r) => r.meeting_id === targetMeetingId && r.kind === "social_payout")
        .reduce((s, r) => s + Number(r.amount || 0), 0);
      const outflowSocialFromFundTxns = fundTxns
        .filter((r) => r.meeting_id === targetMeetingId && r.fund_type === "social_fund" && r.txn_type === "payout")
        .reduce((s, r) => s + Number(r.amount || 0), 0);

      return {
        inflowSavings,
        inflowRepayments,
        inflowFines: inflowFinesFromFinesTable + inflowFinesFromMeetingTxns,
        outflowLoans: outflowLoans + outflowLoansFromDisbursedLoans,
        outflowSocialPayouts: outflowSocialFromMeetingTxns + outflowSocialFromFundTxns,
      };
    },
    [fines, fundTxns, loans, meetingTxns, meetings, repayments, shareTxns]
  );

  const latestSnapshot = rows[0] ?? null;
  const latestCalc = useMemo(() => computeByMeeting(latestSnapshot?.meeting_id), [computeByMeeting, latestSnapshot?.meeting_id]);
  const expected = useMemo(() => {
    if (!latestSnapshot) return 0;
    return (
      Number(latestSnapshot.opening_cash || 0) +
      latestCalc.inflowSavings +
      latestCalc.inflowRepayments +
      latestCalc.inflowFines -
      latestCalc.outflowLoans -
      latestCalc.outflowSocialPayouts
    );
  }, [latestCalc, latestSnapshot]);

  const saveSnapshot = async () => {
    if (readOnly) return;
    setError(null);
    setSuccessMsg(null);
    const { error: e } = await supabase.from("vsla_cashbox_snapshots").insert({
      organization_id: orgId,
      meeting_id: meetingId || null,
      opening_cash: Number(openingCash || 0),
      physical_cash: Number(physicalCash || 0),
    });
    if (e) {
      setError(e.message);
      return;
    }
    setSuccessMsg("Cashbox snapshot saved successfully.");
    await load();
  };

  const latestVariance = latestSnapshot ? Number(latestSnapshot.physical_cash || 0) - expected : 0;

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      {readOnly && <ReadOnlyNotice />}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">VSLA Cashbox / Fund Tracking</h1>
        <p className="text-sm text-slate-600 mt-1">
          Track opening cash, compare expected vs physical cash, and monitor meeting cash variance.
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {successMsg && <p className="text-sm text-emerald-700">{successMsg}</p>}

      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Capture Meeting Cash Snapshot</p>
        <div className="grid md:grid-cols-4 gap-3">
          <label className="text-xs text-slate-600">
            Meeting
            <select value={meetingId} onChange={(e) => setMeetingId(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
              <option value="">Select meeting</option>
              {meetings.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.meeting_date} ({m.status})
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Opening Cash
            <input type="number" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} placeholder="0" className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="text-xs text-slate-600">
            Physical Cash Count
            <input type="number" value={physicalCash} onChange={(e) => setPhysicalCash(e.target.value)} placeholder="0" className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </label>
          <div className="flex items-end">
            <button type="button" onClick={() => void saveSnapshot()} disabled={readOnly} className="w-full px-4 py-2 bg-indigo-700 text-white rounded-lg text-sm disabled:opacity-50">Save Snapshot</button>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <div className="p-3 rounded-lg bg-slate-100 text-sm">Expected Cash (system): <strong>{expected.toLocaleString()}</strong></div>
        <div className="p-3 rounded-lg bg-slate-100 text-sm">Physical Cash (counted): <strong>{Number(latestSnapshot?.physical_cash || 0).toLocaleString()}</strong></div>
        <div className={`p-3 rounded-lg text-sm ${Math.abs(latestVariance) > 0 ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"}`}>
          Cash Variance: <strong>{latestVariance.toLocaleString()}</strong>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-3 border-b border-slate-200">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Latest Snapshot Breakdown</p>
        </div>
        <div className="p-4 grid md:grid-cols-3 gap-3 text-sm">
          <div className="rounded-lg bg-slate-50 p-3">Opening Cash: <strong>{Number(latestSnapshot?.opening_cash || 0).toLocaleString()}</strong></div>
          <div className="rounded-lg bg-slate-50 p-3">Savings Inflow (calculated): <strong>{latestCalc.inflowSavings.toLocaleString()}</strong></div>
          <div className="rounded-lg bg-slate-50 p-3">Repayments Inflow (calculated): <strong>{latestCalc.inflowRepayments.toLocaleString()}</strong></div>
          <div className="rounded-lg bg-slate-50 p-3">Fines Inflow (calculated): <strong>{latestCalc.inflowFines.toLocaleString()}</strong></div>
          <div className="rounded-lg bg-slate-50 p-3">Loans Outflow (calculated): <strong>{latestCalc.outflowLoans.toLocaleString()}</strong></div>
          <div className="rounded-lg bg-slate-50 p-3">Social Payouts Outflow (calculated): <strong>{latestCalc.outflowSocialPayouts.toLocaleString()}</strong></div>
        </div>
      </div>
    </div>
  );
}
