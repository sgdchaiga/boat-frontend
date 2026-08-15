import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";
import { formatVslaMemberLabel } from "@/lib/vslaMemberLabel";

type Loan = {
  id: string;
  member_id: string;
  total_due: number;
  outstanding_balance: number;
  due_date: string | null;
  status: string;
  principal_amount: number;
  interest_rate_percent: number;
  interest_type: "flat" | "declining";
  disbursed_on: string | null;
};
type Member = { id: string; full_name: string; member_number: string | null };
type Repayment = {
  id: string;
  loan_id: string;
  principal_paid: number;
  interest_paid: number;
  penalty_paid: number;
  paid_on: string;
  balance_after: number;
};

export function VslaRepaymentsPage({
  readOnly = false,
}: {
  readOnly?: boolean;
}) {
  const { user, isSuperAdmin } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!isSuperAdmin;
  const [loans, setLoans] = useState<Loan[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [rows, setRows] = useState<Repayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [lRes, mRes, rRes] = await Promise.all([
      filterByOrganizationId(
        supabase
          .from("vsla_loans")
          .select(
            "id,member_id,total_due,outstanding_balance,due_date,status,principal_amount,interest_rate_percent,interest_type,disbursed_on",
          )
          .order("applied_at", { ascending: false }),
        orgId,
        superAdmin,
      ),
      filterByOrganizationId(
        supabase.from("vsla_members").select("id,full_name,member_number"),
        orgId,
        superAdmin,
      ),
      filterByOrganizationId(
        supabase
          .from("vsla_loan_repayments")
          .select("*")
          .order("paid_on", { ascending: false }),
        orgId,
        superAdmin,
      ),
    ]);
    if (lRes.error || mRes.error || rRes.error)
      setError(
        lRes.error?.message ??
          mRes.error?.message ??
          rRes.error?.message ??
          "Failed to load repayments.",
      );
    setLoans((lRes.data ?? []) as Loan[]);
    setMembers((mRes.data ?? []) as Member[]);
    setRows((rRes.data ?? []) as Repayment[]);
    setLoading(false);
  }, [orgId, superAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const memberName = useMemo(
    () => new Map(members.map((m) => [m.id, formatVslaMemberLabel(m)])),
    [members],
  );
  const loanMap = useMemo(() => new Map(loans.map((l) => [l.id, l])), [loans]);
  const overdueCount = loans.filter(
    (l) =>
      l.status === "disbursed" &&
      l.outstanding_balance > 0 &&
      !!l.due_date &&
      new Date(l.due_date) < new Date(),
  ).length;

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {readOnly && <ReadOnlyNotice />}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          VSLA Loan Repayments
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Consolidated repayment history. Record new payments during an open meeting.
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-sm text-amber-700">Overdue loans: {overdueCount}</p>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left p-3">Date</th>
              <th className="text-left p-3">Member</th>
              <th className="text-left p-3">Principal</th>
              <th className="text-left p-3">Interest</th>
              <th className="text-left p-3">Penalty</th>
              <th className="text-left p-3">Total paid</th>
              <th className="text-left p-3">Balance</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="p-4 text-slate-500" colSpan={7}>
                  Loading repayments...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="p-4 text-slate-500" colSpan={7}>
                  No repayments yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="p-3">{r.paid_on}</td>
                  <td className="p-3">{memberName.get(loanMap.get(r.loan_id)?.member_id || "") ?? "Unknown"}</td>
                  <td className="p-3">
                    {Number(r.principal_paid || 0).toLocaleString()}
                  </td>
                  <td className="p-3">
                    {Number(r.interest_paid || 0).toLocaleString()}
                  </td>
                  <td className="p-3">
                    {Number(r.penalty_paid || 0).toLocaleString()}
                  </td>
                  <td className="p-3 font-semibold">{(Number(r.principal_paid || 0)+Number(r.interest_paid || 0)+Number(r.penalty_paid || 0)).toLocaleString()}</td>
                  <td className="p-3">{Number(r.balance_after || 0).toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
