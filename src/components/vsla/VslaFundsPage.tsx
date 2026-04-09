import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";

type FundTxn = { id: string; fund_type: "loan_fund" | "social_fund"; txn_type: "contribution" | "payout"; amount: number; reason: string | null; meeting_id: string | null; created_at: string };
type Fine = { id: string; member_id: string; fine_type: "late_coming" | "absenteeism" | "misconduct"; amount: number; meeting_id: string | null; created_at: string };
type Member = { id: string; full_name: string };

export function VslaFundsPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user, isSuperAdmin } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!isSuperAdmin;
  const [members, setMembers] = useState<Member[]>([]);
  const [fines, setFines] = useState<Fine[]>([]);
  const [fundTxns, setFundTxns] = useState<FundTxn[]>([]);
  const [memberId, setMemberId] = useState("");
  const [fineType, setFineType] = useState<Fine["fine_type"]>("late_coming");
  const [fineAmount, setFineAmount] = useState("0");
  const [fundType, setFundType] = useState<FundTxn["fund_type"]>("social_fund");
  const [txnType, setTxnType] = useState<FundTxn["txn_type"]>("contribution");
  const [fundAmount, setFundAmount] = useState("0");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [mRes, fRes, tRes] = await Promise.all([
      filterByOrganizationId(supabase.from("vsla_members").select("id,full_name").order("full_name"), orgId, superAdmin),
      filterByOrganizationId(supabase.from("vsla_fines").select("*").order("created_at", { ascending: false }), orgId, superAdmin),
      filterByOrganizationId(supabase.from("vsla_fund_transactions").select("*").order("created_at", { ascending: false }), orgId, superAdmin),
    ]);
    setMembers((mRes.data ?? []) as Member[]);
    setFines((fRes.data ?? []) as Fine[]);
    setFundTxns((tRes.data ?? []) as FundTxn[]);
    setError(mRes.error?.message ?? fRes.error?.message ?? tRes.error?.message ?? null);
    setLoading(false);
  }, [orgId, superAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const postFine = async () => {
    if (readOnly) return;
    setError(null);
    setSuccessMsg(null);
    const amount = Number(fineAmount || 0);
    if (!memberId || amount <= 0) {
      setError("Select member and enter a valid fine amount.");
      return;
    }
    const { error: e } = await supabase.from("vsla_fines").insert({
      organization_id: orgId,
      member_id: memberId,
      fine_type: fineType,
      amount,
    });
    if (e) {
      setError(e.message);
      return;
    }
    setFineAmount("0");
    setSuccessMsg("Fine has been successfully posted.");
    await load();
  };
  const postFundTxn = async () => {
    if (readOnly) return;
    setError(null);
    setSuccessMsg(null);
    await supabase.from("vsla_fund_transactions").insert({
      organization_id: orgId,
      fund_type: fundType,
      txn_type: txnType,
      amount: Number(fundAmount || 0),
      reason: reason.trim() || null,
    });
    setFundAmount("0");
    setReason("");
    await load();
  };

  const socialFundBal = fundTxns.filter((x) => x.fund_type === "social_fund").reduce((s, x) => s + (x.txn_type === "contribution" ? x.amount : -x.amount), 0);
  const loanFundBal = fundTxns.filter((x) => x.fund_type === "loan_fund").reduce((s, x) => s + (x.txn_type === "contribution" ? x.amount : -x.amount), 0);

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {readOnly && <ReadOnlyNotice />}
      <h1 className="text-2xl font-bold text-slate-900">VSLA Fines & Social Fund</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {successMsg && <p className="text-sm text-emerald-700">{successMsg}</p>}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-lg bg-slate-100 text-sm">Loan Fund Balance: <strong>{loanFundBal.toLocaleString()}</strong></div>
        <div className="p-3 rounded-lg bg-slate-100 text-sm">Social Fund Balance: <strong>{socialFundBal.toLocaleString()}</strong></div>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Record Fine</p>
          <select value={memberId} onChange={(e) => setMemberId(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">Select member</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
          </select>
          <select value={fineType} onChange={(e) => setFineType(e.target.value as Fine["fine_type"])} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="late_coming">Late Coming</option>
            <option value="absenteeism">Absenteeism</option>
            <option value="misconduct">Misconduct</option>
          </select>
          <input type="number" value={fineAmount} onChange={(e) => setFineAmount(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <button type="button" className="px-4 py-2 bg-indigo-700 text-white rounded-lg text-sm" disabled={readOnly} onClick={() => void postFine()}>Post Fine</button>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Social/Loan Fund Transaction</p>
          <select value={fundType} onChange={(e) => setFundType(e.target.value as FundTxn["fund_type"])} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="social_fund">Social Fund</option>
            <option value="loan_fund">Loan Fund</option>
          </select>
          <select value={txnType} onChange={(e) => setTxnType(e.target.value as FundTxn["txn_type"])} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="contribution">Contribution</option>
            <option value="payout">Payout</option>
          </select>
          <input type="number" value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <button type="button" className="px-4 py-2 bg-indigo-700 text-white rounded-lg text-sm" disabled={readOnly} onClick={() => void postFundTxn()}>Post Transaction</button>
        </div>
      </div>
      {loading ? <p className="text-slate-500 text-sm">Loading...</p> : null}
    </div>
  );
}
