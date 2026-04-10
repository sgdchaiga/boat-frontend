import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";
import { computeVslaLoanOutstanding } from "@/lib/vslaLoanMath";
import { formatVslaMemberLabel } from "@/lib/vslaMemberLabel";

type MemberRow = {
  id: string;
  full_name: string;
  member_number: string | null;
};
type LoanRow = {
  id: string;
  member_id: string;
  principal_amount: number;
  interest_rate_percent: number;
  interest_type: "flat" | "declining";
  duration_meetings: number;
  total_due: number;
  outstanding_balance: number;
  due_date: string | null;
  disbursed_on: string | null;
  notes: string | null;
  status: string;
};
type RepaymentRow = {
  loan_id: string;
  principal_paid: number;
  interest_paid: number;
  penalty_paid: number;
  paid_on: string;
};

export function VslaLoansPage({
  readOnly = false,
}: {
  readOnly?: boolean;
  onNavigate?: (page: string, state?: Record<string, unknown>) => void;
}) {
  const { user, isSuperAdmin } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!isSuperAdmin;
  const [tab, setTab] = useState<"management" | "repayments">("management");
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [repayments, setRepayments] = useState<RepaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingLoanId, setEditingLoanId] = useState<string | null>(null);
  const [memberId, setMemberId] = useState("");
  const [principal, setPrincipal] = useState("0");
  const [interestRate, setInterestRate] = useState("10");
  const [duration, setDuration] = useState("4");
  const [interestType, setInterestType] = useState<"flat" | "declining">(
    "flat",
  );
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedLoanId, setSelectedLoanId] = useState("");
  const [repaymentAmount, setRepaymentAmount] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [mRes, lRes, rRes] = await Promise.all([
      filterByOrganizationId(
        supabase
          .from("vsla_members")
          .select("id,full_name,member_number")
          .eq("status", "active"),
        orgId,
        superAdmin,
      ),
      filterByOrganizationId(
        supabase
          .from("vsla_loans")
          .select("*")
          .order("applied_at", { ascending: false }),
        orgId,
        superAdmin,
      ),
      filterByOrganizationId(
        supabase
          .from("vsla_loan_repayments")
          .select("loan_id,principal_paid,interest_paid,penalty_paid,paid_on"),
        orgId,
        superAdmin,
      ),
    ]);
    if (mRes.error || lRes.error || rRes.error) {
      setError(
        mRes.error?.message ??
          lRes.error?.message ??
          rRes.error?.message ??
          "Failed to load loans.",
      );
    }
    const loansData = (lRes.data ?? []) as LoanRow[];
    const repaymentsData = (rRes.data ?? []) as RepaymentRow[];
    setMembers((mRes.data ?? []) as MemberRow[]);
    setRepayments(repaymentsData);
    setLoans(
      loansData.map((l) => {
        if (l.status !== "disbursed" || !l.disbursed_on) return l;
        const result = computeVslaLoanOutstanding(
          l,
          repaymentsData.filter((r) => r.loan_id === l.id),
        );
        return {
          ...l,
          outstanding_balance: result.outstanding,
          total_due: result.totalDue,
        };
      }),
    );
    setLoading(false);
  }, [orgId, superAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const memberName = useMemo(
    () => new Map(members.map((m) => [m.id, formatVslaMemberLabel(m)])),
    [members],
  );
  const memberPlainName = useMemo(
    () =>
      new Map(
        members.map((m) => [m.id, (m.full_name ?? "").trim() || "Unknown"]),
      ),
    [members],
  );
  const memberNumberById = useMemo(
    () =>
      new Map(
        members.map((m) => [
          m.id,
          (m.member_number ?? "").trim() ? m.member_number!.trim() : "—",
        ]),
      ),
    [members],
  );

  const preview = useMemo(() => {
    const p = Number(principal);
    const r = Number(interestRate) / 100;
    const m = Number(duration);
    if (p <= 0 || r < 0 || m <= 0) return null;
    if (interestType === "flat")
      return { totalInterest: p * r * m, totalDue: p + p * r * m };
    let balance = p;
    let interest = 0;
    for (let i = 0; i < m; i++) {
      interest += balance * r;
      balance = Math.max(0, balance - p / m);
    }
    return { totalInterest: interest, totalDue: p + interest };
  }, [duration, interestRate, interestType, principal]);

  const saveLoan = async () => {
    if (readOnly) return;
    const p = Number(principal);
    const r = Number(interestRate);
    const m = Number(duration);
    if (
      !memberId ||
      p <= 0 ||
      !Number.isFinite(r) ||
      !Number.isFinite(m) ||
      m <= 0
    )
      return;
    setSaving(true);
    setError(null);
    const payload = {
      member_id: memberId,
      principal_amount: p,
      interest_rate_percent: r,
      interest_type: interestType,
      duration_meetings: m,
      total_due: p,
      outstanding_balance: p,
      due_date: dueDate || null,
      notes: notes.trim() || null,
    };
    const res = editingLoanId
      ? await supabase
          .from("vsla_loans")
          .update(payload)
          .eq("id", editingLoanId)
      : await supabase
          .from("vsla_loans")
          .insert({ organization_id: orgId, status: "applied", ...payload });
    if (res.error) setError(res.error.message);
    setEditingLoanId(null);
    setMemberId("");
    setPrincipal("0");
    setInterestRate("10");
    setDuration("4");
    setInterestType("flat");
    setDueDate("");
    setNotes("");
    setSaving(false);
    await load();
  };

  const editLoan = (l: LoanRow) => {
    setEditingLoanId(l.id);
    setMemberId(l.member_id);
    setPrincipal(String(l.principal_amount));
    setInterestRate(String(l.interest_rate_percent));
    setDuration(String(l.duration_meetings));
    setInterestType(l.interest_type ?? "flat");
    setDueDate(l.due_date || "");
    setNotes(l.notes || "");
  };

  const approveLoan = async (id: string) => {
    if (readOnly) return;
    await supabase
      .from("vsla_loans")
      .update({ status: "approved" })
      .eq("id", id);
    await load();
  };

  const makeRepayment = async () => {
    if (readOnly) return;
    const loan = loans.find((l) => l.id === selectedLoanId);
    const amount = Number(repaymentAmount);
    if (!loan || amount <= 0) return;
    await supabase.from("vsla_loan_repayments").insert({
      organization_id: orgId,
      loan_id: loan.id,
      principal_paid: amount,
      interest_paid: 0,
      penalty_paid: 0,
      paid_on: new Date().toISOString().slice(0, 10),
    });
    const latestRepayments = [
      ...repayments,
      {
        loan_id: loan.id,
        principal_paid: amount,
        interest_paid: 0,
        penalty_paid: 0,
        paid_on: new Date().toISOString().slice(0, 10),
      },
    ];
    const calc = computeVslaLoanOutstanding(
      loan,
      latestRepayments.filter((r) => r.loan_id === loan.id),
    );
    await supabase
      .from("vsla_loans")
      .update({
        outstanding_balance: calc.outstanding,
        total_due: calc.totalDue,
        status: calc.outstanding <= 0 ? "closed" : loan.status,
      })
      .eq("id", loan.id);
    setRepaymentAmount("");
    setSelectedLoanId("");
    await load();
  };

  return (
    <div className="px-4 py-6 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {readOnly && <ReadOnlyNotice />}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">VSLA Loans</h1>
        <p className="text-sm text-slate-600 mt-1">
          Accrual starts from disbursement date and recalculates balance
          monthly.
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTab("management")}
          className={`min-h-[44px] px-4 py-2 rounded-lg text-sm touch-manipulation ${tab === "management" ? "bg-indigo-700 text-white" : "bg-slate-100 text-slate-700"}`}
        >
          Loan Management
        </button>
        <button
          type="button"
          onClick={() => setTab("repayments")}
          className={`min-h-[44px] px-4 py-2 rounded-lg text-sm touch-manipulation ${tab === "repayments" ? "bg-indigo-700 text-white" : "bg-slate-100 text-slate-700"}`}
        >
          Repayments
        </button>
      </div>

      {tab === "management" && (
        <>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <label className="text-xs text-slate-600 md:col-span-2">
                Member
                <select
                  value={memberId}
                  onChange={(e) => setMemberId(e.target.value)}
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Select Member</option>
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
                  value={principal}
                  onChange={(e) => setPrincipal(e.target.value)}
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </label>
              <label className="text-xs text-slate-600">
                Interest % / month
                <input
                  value={interestRate}
                  onChange={(e) => setInterestRate(e.target.value)}
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </label>
              <label className="text-xs text-slate-600">
                Duration (months)
                <input
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </label>
              <label className="text-xs text-slate-600">
                Interest Type
                <select
                  value={interestType}
                  onChange={(e) =>
                    setInterestType(e.target.value as "flat" | "declining")
                  }
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="flat">Flat</option>
                  <option value="declining">Declining</option>
                </select>
              </label>
              <label className="text-xs text-slate-600">
                Due Date
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </label>
              <label className="text-xs text-slate-600 md:col-span-2">
                Notes
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </label>
            </div>
            <div className="mt-3">
              <button
                type="button"
                onClick={saveLoan}
                disabled={saving || readOnly}
                className="px-4 py-2 rounded-lg bg-indigo-700 text-white text-sm disabled:opacity-50"
              >
                {editingLoanId ? "Update Loan" : "Save Loan"}
              </button>
            </div>
          </div>
          {preview && (
            <p className="text-sm text-slate-600">
              Projected interest: {preview.totalInterest.toLocaleString()} |
              Projected total: {preview.totalDue.toLocaleString()}
            </p>
          )}
          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left p-3">Member</th>
                  <th className="text-left p-3">Member no.</th>
                  <th className="text-left p-3">Principal</th>
                  <th className="text-left p-3">Outstanding</th>
                  <th className="text-left p-3">Disbursement date</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-left p-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="p-4 text-slate-500" colSpan={7}>
                      Loading loans...
                    </td>
                  </tr>
                ) : (
                  loans.map((l) => (
                    <tr key={l.id} className="border-b border-slate-100">
                      <td className="p-3">
                        {memberPlainName.get(l.member_id) ?? "Unknown"}
                      </td>
                      <td className="p-3 text-slate-600">
                        {memberNumberById.get(l.member_id) ?? "—"}
                      </td>
                      <td className="p-3">
                        {Number(l.principal_amount || 0).toLocaleString()}
                      </td>
                      <td className="p-3">
                        {Number(l.outstanding_balance || 0).toLocaleString()}
                      </td>
                      <td className="p-3 text-slate-700">
                        {l.disbursed_on?.trim()
                          ? l.disbursed_on
                          : "—"}
                      </td>
                      <td className="p-3 capitalize">{l.status}</td>
                      <td className="p-3 space-x-2">
                        <button
                          type="button"
                          onClick={() => editLoan(l)}
                          className="min-h-[40px] min-w-[72px] px-3 py-2 rounded-md bg-slate-100 text-slate-700 touch-manipulation"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void approveLoan(l.id)}
                          className="min-h-[40px] min-w-[72px] px-3 py-2 rounded-md bg-indigo-100 text-indigo-700 touch-manipulation"
                        >
                          Approve
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "repayments" && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <label className="text-xs text-slate-600">
            Loan
            <select
              value={selectedLoanId}
              onChange={(e) => setSelectedLoanId(e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Select Loan</option>
              {loans
                .filter(
                  (l) => l.status === "disbursed" && l.outstanding_balance > 0,
                )
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {memberName.get(l.member_id) ?? "Unknown"} - Balance:{" "}
                    {Number(l.outstanding_balance || 0).toLocaleString()}
                    {l.disbursed_on?.trim()
                      ? ` · disbursed ${l.disbursed_on}`
                      : ""}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Repayment Amount
            <input
              value={repaymentAmount}
              onChange={(e) => setRepaymentAmount(e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => void makeRepayment()}
            disabled={readOnly}
            className="px-4 py-2 rounded-lg bg-indigo-700 text-white text-sm disabled:opacity-50"
          >
            Post Repayment
          </button>
        </div>
      )}
    </div>
  );
}
