import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";

type Loan = { id: string; member_id: string; total_due: number; outstanding_balance: number; due_date: string | null; status: string };
type Member = { id: string; full_name: string };
type Repayment = { id: string; loan_id: string; principal_paid: number; interest_paid: number; penalty_paid: number; paid_on: string };

export function VslaRepaymentsPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user, isSuperAdmin } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!isSuperAdmin;
  const [loans, setLoans] = useState<Loan[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [rows, setRows] = useState<Repayment[]>([]);
  const [loanId, setLoanId] = useState("");
  const [principalPaid, setPrincipalPaid] = useState("0");
  const [interestPaid, setInterestPaid] = useState("0");
  const [penaltyPaid, setPenaltyPaid] = useState("0");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [lRes, mRes, rRes] = await Promise.all([
      filterByOrganizationId(supabase.from("vsla_loans").select("id,member_id,total_due,outstanding_balance,due_date,status").order("applied_at", { ascending: false }), orgId, superAdmin),
      filterByOrganizationId(supabase.from("vsla_members").select("id,full_name"), orgId, superAdmin),
      filterByOrganizationId(supabase.from("vsla_loan_repayments").select("*").order("paid_on", { ascending: false }), orgId, superAdmin),
    ]);
    if (lRes.error || mRes.error || rRes.error) setError(lRes.error?.message ?? mRes.error?.message ?? rRes.error?.message ?? "Failed to load repayments.");
    setLoans((lRes.data ?? []) as Loan[]);
    setMembers((mRes.data ?? []) as Member[]);
    setRows((rRes.data ?? []) as Repayment[]);
    setLoading(false);
  }, [orgId, superAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const memberName = useMemo(() => new Map(members.map((m) => [m.id, m.full_name])), [members]);
  const loanMap = useMemo(() => new Map(loans.map((l) => [l.id, l])), [loans]);
  const overdueCount = loans.filter((l) => l.status === "disbursed" && l.outstanding_balance > 0 && !!l.due_date && new Date(l.due_date) < new Date()).length;

  const postRepayment = async () => {
    if (readOnly) return;
    const p = Number(principalPaid || 0);
    const i = Number(interestPaid || 0);
    const pen = Number(penaltyPaid || 0);
    const total = p + i + pen;
    if (!loanId || total <= 0) {
      setError("Loan and payment amount are required.");
      return;
    }
    const loan = loanMap.get(loanId);
    if (!loan) return;
    const nextOutstanding = Math.max(0, Number(loan.outstanding_balance || 0) - total);
    setSaving(true);
    setError(null);
    const ins = await supabase.from("vsla_loan_repayments").insert({
      organization_id: orgId,
      loan_id: loanId,
      principal_paid: p,
      interest_paid: i,
      penalty_paid: pen,
      paid_on: new Date().toISOString().slice(0, 10),
    });
    if (ins.error) {
      setError(ins.error.message);
      setSaving(false);
      return;
    }
    await supabase.from("vsla_loans").update({
      outstanding_balance: nextOutstanding,
      status: nextOutstanding <= 0 ? "closed" : loan.status,
    }).eq("id", loanId);
    setPrincipalPaid("0");
    setInterestPaid("0");
    setPenaltyPaid("0");
    setSaving(false);
    await load();
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {readOnly && <ReadOnlyNotice />}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">VSLA Loan Repayments</h1>
        <p className="text-sm text-slate-600 mt-1">Record principal/interest splits, support partial payments, and flag overdue loans.</p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-sm text-amber-700">Overdue loans: {overdueCount}</p>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Record Repayment</p>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <label className="text-xs text-slate-600 md:col-span-2">Loan
            <select value={loanId} onChange={(e) => setLoanId(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
              <option value="">Select loan</option>
              {loans.filter((l) => l.status === "disbursed" || l.status === "approved").map((l) => (
                <option key={l.id} value={l.id}>{memberName.get(l.member_id) ?? "Unknown"} - Outstanding {Number(l.outstanding_balance || 0).toLocaleString()}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-600">Principal
            <input type="number" value={principalPaid} onChange={(e) => setPrincipalPaid(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="text-xs text-slate-600">Interest
            <input type="number" value={interestPaid} onChange={(e) => setInterestPaid(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="text-xs text-slate-600">Penalty
            <input type="number" value={penaltyPaid} onChange={(e) => setPenaltyPaid(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </label>
        </div>
        <div className="mt-3">
          <button type="button" onClick={() => void postRepayment()} disabled={readOnly || saving} className="px-4 py-2 rounded-lg bg-indigo-700 text-white text-sm disabled:opacity-50">
            Post Repayment
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left p-3">Date</th>
              <th className="text-left p-3">Loan</th>
              <th className="text-left p-3">Principal</th>
              <th className="text-left p-3">Interest</th>
              <th className="text-left p-3">Penalty</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td className="p-4 text-slate-500" colSpan={5}>Loading repayments...</td></tr> : rows.length === 0 ? <tr><td className="p-4 text-slate-500" colSpan={5}>No repayments yet.</td></tr> : rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-100">
                <td className="p-3">{r.paid_on}</td>
                <td className="p-3">{r.loan_id.slice(0, 8)}...</td>
                <td className="p-3">{Number(r.principal_paid || 0).toLocaleString()}</td>
                <td className="p-3">{Number(r.interest_paid || 0).toLocaleString()}</td>
                <td className="p-3">{Number(r.penalty_paid || 0).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
