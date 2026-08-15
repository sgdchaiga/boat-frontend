import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";
import { formatVslaMemberLabel } from "@/lib/vslaMemberLabel";

type Member = { id: string; full_name: string; member_number: string | null };
type Loan = { id: string; member_id: string; principal_amount: number; interest_rate_percent: number; duration_meetings: number; total_due: number; outstanding_balance: number; due_date: string | null; disbursed_on: string | null; status: string };
type Repayment = { id: string; loan_id: string; principal_paid: number; interest_paid: number; penalty_paid: number; paid_on: string; balance_after: number };

export function VslaLoansPage({ readOnly = false }: { readOnly?: boolean; onNavigate?: (page: string, state?: Record<string, unknown>) => void }) {
  const { user, isSuperAdmin } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!isSuperAdmin;
  const [tab, setTab] = useState<"loans" | "repayments">("loans");
  const [members, setMembers] = useState<Member[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [repayments, setRepayments] = useState<Repayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const [memberResult, loanResult, repaymentResult] = await Promise.all([
      filterByOrganizationId(supabase.from("vsla_members").select("id,full_name,member_number").order("full_name"), orgId, superAdmin),
      filterByOrganizationId(supabase.from("vsla_loans").select("id,member_id,principal_amount,interest_rate_percent,duration_meetings,total_due,outstanding_balance,due_date,disbursed_on,status").in("status", ["disbursed", "closed", "defaulted"]).order("disbursed_on", { ascending: false }), orgId, superAdmin),
      filterByOrganizationId(supabase.from("vsla_loan_repayments").select("id,loan_id,principal_paid,interest_paid,penalty_paid,paid_on,balance_after").order("paid_on", { ascending: false }), orgId, superAdmin),
    ]);
    const failure = memberResult.error || loanResult.error || repaymentResult.error;
    if (failure) setError(failure.message);
    setMembers((memberResult.data || []) as Member[]); setLoans((loanResult.data || []) as Loan[]); setRepayments((repaymentResult.data || []) as Repayment[]); setLoading(false);
  }, [orgId, superAdmin]);
  useEffect(() => { void load(); }, [load]);

  const memberNames = useMemo(() => new Map(members.map((member) => [member.id, formatVslaMemberLabel(member)])), [members]);
  const loanMap = useMemo(() => new Map(loans.map((loan) => [loan.id, loan])), [loans]);
  const paidByLoan = useMemo(() => { const map = new Map<string, { principal: number; interest: number; total: number }>(); repayments.forEach((row) => { const value = map.get(row.loan_id) || { principal: 0, interest: 0, total: 0 }; value.principal += Number(row.principal_paid); value.interest += Number(row.interest_paid); value.total += Number(row.principal_paid)+Number(row.interest_paid)+Number(row.penalty_paid); map.set(row.loan_id, value); }); return map; }, [repayments]);

  return <div className="px-4 py-6 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
    {readOnly && <ReadOnlyNotice />}
    <div><h1 className="text-2xl font-bold text-slate-900">VSLA Loan Register</h1><p className="mt-1 text-sm text-slate-600">All loans disbursed by member consensus during meetings and all repayments received.</p></div>
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    <div className="flex gap-2"><button onClick={() => setTab("loans")} className={`min-h-11 rounded-lg px-4 text-sm ${tab === "loans" ? "bg-indigo-700 text-white" : "bg-slate-100"}`}>Disbursed Loans</button><button onClick={() => setTab("repayments")} className={`min-h-11 rounded-lg px-4 text-sm ${tab === "repayments" ? "bg-indigo-700 text-white" : "bg-slate-100"}`}>Repayments</button></div>
    {tab === "loans" ? <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[850px] text-sm"><thead className="bg-slate-50"><tr><th className="p-3 text-left">Member</th><th className="p-3 text-right">Loan disbursed</th><th className="p-3 text-right">Period</th><th className="p-3 text-right">Interest</th><th className="p-3 text-right">Principal paid</th><th className="p-3 text-right">Interest paid</th><th className="p-3 text-right">Balance</th><th className="p-3 text-left">Disbursed</th><th className="p-3 text-left">Status</th></tr></thead><tbody>{loans.map((loan) => { const paid = paidByLoan.get(loan.id) || { principal: 0, interest: 0, total: 0 }; return <tr key={loan.id} className="border-t"><td className="p-3 font-medium">{memberNames.get(loan.member_id) || "Unknown"}</td><td className="p-3 text-right">{Number(loan.principal_amount).toLocaleString()}</td><td className="p-3 text-right">{loan.duration_meetings} months</td><td className="p-3 text-right">{loan.interest_rate_percent}%</td><td className="p-3 text-right">{paid.principal.toLocaleString()}</td><td className="p-3 text-right">{paid.interest.toLocaleString()}</td><td className="p-3 text-right font-bold">{Number(loan.outstanding_balance).toLocaleString()}</td><td className="p-3">{loan.disbursed_on || "—"}</td><td className="p-3 capitalize">{loan.status}</td></tr>; })}{!loading && !loans.length && <tr><td colSpan={9} className="p-8 text-center text-slate-500">No meeting loans have been disbursed.</td></tr>}</tbody></table>{loading && <p className="p-6 text-center text-slate-500">Loading loans…</p>}</div> : <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[700px] text-sm"><thead className="bg-slate-50"><tr><th className="p-3 text-left">Date</th><th className="p-3 text-left">Member</th><th className="p-3 text-right">Loan paid</th><th className="p-3 text-right">Interest paid</th><th className="p-3 text-right">Total paid</th><th className="p-3 text-right">Balance</th></tr></thead><tbody>{repayments.map((row) => { const loan = loanMap.get(row.loan_id); const total = Number(row.principal_paid)+Number(row.interest_paid)+Number(row.penalty_paid); return <tr key={row.id} className="border-t"><td className="p-3">{row.paid_on}</td><td className="p-3 font-medium">{loan ? memberNames.get(loan.member_id) || "Unknown" : "Unknown"}</td><td className="p-3 text-right">{Number(row.principal_paid).toLocaleString()}</td><td className="p-3 text-right">{Number(row.interest_paid).toLocaleString()}</td><td className="p-3 text-right font-semibold">{total.toLocaleString()}</td><td className="p-3 text-right">{Number(row.balance_after || 0).toLocaleString()}</td></tr>; })}{!loading && !repayments.length && <tr><td colSpan={6} className="p-8 text-center text-slate-500">No repayments have been recorded.</td></tr>}</tbody></table>{loading && <p className="p-6 text-center text-slate-500">Loading repayments…</p>}</div>}
  </div>;
}
