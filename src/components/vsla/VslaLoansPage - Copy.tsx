```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";

export function VslaLoansPage() {
  const { user, isSuperAdmin } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!isSuperAdmin;

  const [tab, setTab] = useState<"management" | "repayments">("management");

  const [members, setMembers] = useState<any[]>([]);
  const [loans, setLoans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // FORM STATE
  const [editingLoanId, setEditingLoanId] = useState<string | null>(null);
  const [memberId, setMemberId] = useState("");
  const [guarantorId, setGuarantorId] = useState("");
  const [principal, setPrincipal] = useState("0");
  const [interestRate, setInterestRate] = useState("10");
  const [duration, setDuration] = useState("4");
  const [interestType, setInterestType] = useState<"flat" | "declining">("flat");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");

  // REPAYMENT STATE
  const [selectedLoanId, setSelectedLoanId] = useState("");
  const [repaymentAmount, setRepaymentAmount] = useState("");

  // LOAD DATA
  const load = useCallback(async () => {
    setLoading(true);

    const [mRes, lRes] = await Promise.all([
      filterByOrganizationId(
        supabase.from("vsla_members").select("id,full_name").eq("status", "active"),
        orgId,
        superAdmin
      ),
      filterByOrganizationId(
        supabase.from("vsla_loans").select("*").order("applied_at", { ascending: false }),
        orgId,
        superAdmin
      ),
    ]);

    setMembers(mRes.data || []);
    setLoans(lRes.data || []);
    setLoading(false);
  }, [orgId, superAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  const memberName = useMemo(
    () => new Map(members.map((m) => [m.id, m.full_name])),
    [members]
  );

  // INTEREST CALCULATION
  const calculateLoan = (p: number, r: number, m: number, type: string) => {
    let totalInterest = 0;

    if (type === "flat") {
      totalInterest = (p * r * m) / 100;
    } else {
      let balance = p;
      const monthlyPrincipal = p / m;

      for (let i = 0; i < m; i++) {
        totalInterest += (balance * r) / 100;
        balance -= monthlyPrincipal;
      }
    }

    return {
      totalInterest,
      totalDue: p + totalInterest,
    };
  };

  const preview = useMemo(() => {
    const p = Number(principal);
    const r = Number(interestRate);
    const m = Number(duration);

    if (p <= 0 || r < 0 || m <= 0) return null;

    return calculateLoan(p, r, m, interestType);
  }, [principal, interestRate, duration, interestType]);

  // SAVE LOAN
  const saveLoan = async () => {
    const p = Number(principal);
    const r = Number(interestRate);
    const m = Number(duration);

    if (!memberId || p <= 0) return;

    const { totalDue } = calculateLoan(p, r, m, interestType);

    setSaving(true);

    if (editingLoanId) {
      await supabase
        .from("vsla_loans")
        .update({
          member_id: memberId,
          principal_amount: p,
          interest_rate_percent: r,
          duration_meetings: m,
          total_due: totalDue,
          outstanding_balance: totalDue,
          due_date: dueDate || null,
          notes,
        })
        .eq("id", editingLoanId);
    } else {
      await supabase.from("vsla_loans").insert({
        organization_id: orgId,
        member_id: memberId,
        principal_amount: p,
        interest_rate_percent: r,
        duration_meetings: m,
        total_due: totalDue,
        outstanding_balance: totalDue,
        status: "applied",
        due_date: dueDate || null,
        notes,
      });
    }

    resetForm();
    setSaving(false);
    load();
  };

  const resetForm = () => {
    setEditingLoanId(null);
    setMemberId("");
    setPrincipal("0");
    setInterestRate("10");
    setDuration("4");
    setNotes("");
  };

  // EDIT
  const editLoan = (l: any) => {
    setEditingLoanId(l.id);
    setMemberId(l.member_id);
    setPrincipal(String(l.principal_amount));
    setInterestRate(String(l.interest_rate_percent));
    setDuration(String(l.duration_meetings));
    setDueDate(l.due_date || "");
    setNotes(l.notes || "");
  };

  // APPROVE
  const approveLoan = async (id: string) => {
    await supabase.from("vsla_loans").update({ status: "approved" }).eq("id", id);
    load();
  };

  // REPAYMENT
  const makeRepayment = async () => {
    const loan = loans.find((l) => l.id === selectedLoanId);
    if (!loan) return;

    const amount = Number(repaymentAmount);
    const newBalance = loan.outstanding_balance - amount;

    await supabase.from("vsla_loan_repayments").insert({
      loan_id: loan.id,
      amount,
    });

    await supabase
      .from("vsla_loans")
      .update({
        outstanding_balance: newBalance,
        status: newBalance <= 0 ? "closed" : loan.status,
      })
      .eq("id", loan.id);

    setRepaymentAmount("");
    setSelectedLoanId("");
    load();
  };

  return (
    <div className="p-6 space-y-6">

      <h1 className="text-2xl font-bold">VSLA Loans</h1>

      {/* TABS */}
      <div className="flex gap-2">
        <button onClick={() => setTab("management")}>Loan Management</button>
        <button onClick={() => setTab("repayments")}>Repayments</button>
      </div>

      {/* MANAGEMENT */}
      {tab === "management" && (
        <>
          <div className="grid md:grid-cols-4 gap-2">

            <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              <option>Select Member</option>
              {members.map(m => (
                <option key={m.id} value={m.id}>{m.full_name}</option>
              ))}
            </select>

            <input value={principal} onChange={(e) => setPrincipal(e.target.value)} placeholder="Principal" />
            <input value={interestRate} onChange={(e) => setInterestRate(e.target.value)} placeholder="Interest %" />
            <input value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="Duration" />

            <select value={interestType} onChange={(e) => setInterestType(e.target.value as any)}>
              <option value="flat">Flat</option>
              <option value="declining">Declining</option>
            </select>

            <button onClick={saveLoan}>
              {editingLoanId ? "Update" : "Save"}
            </button>
          </div>

          {preview && (
            <p>
              Interest: {preview.totalInterest} | Total: {preview.totalDue}
            </p>
          )}

          <table className="w-full">
            <thead>
              <tr>
                <th>Member</th>
                <th>Principal</th>
                <th>Total</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {loans.map(l => (
                <tr key={l.id}>
                  <td>{memberName.get(l.member_id)}</td>
                  <td>{l.principal_amount}</td>
                  <td>{l.total_due}</td>
                  <td>{l.status}</td>
                  <td>
                    <button onClick={() => editLoan(l)}>Edit</button>
                    <button onClick={() => approveLoan(l.id)}>Approve</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* REPAYMENTS */}
      {tab === "repayments" && (
        <div>
          <select onChange={(e) => setSelectedLoanId(e.target.value)}>
            <option>Select Loan</option>
            {loans.map(l => (
              <option key={l.id} value={l.id}>
                {l.id} - Balance: {l.outstanding_balance}
              </option>
            ))}
          </select>

          <input
            value={repaymentAmount}
            onChange={(e) => setRepaymentAmount(e.target.value)}
            placeholder="Amount"
          />

          <button onClick={makeRepayment}>Pay</button>
        </div>
      )}

    </div>
  );
}
```
