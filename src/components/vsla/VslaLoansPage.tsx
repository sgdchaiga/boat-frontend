import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";
import { VSLA_PAGE } from "@/lib/vslaPages";

type Member = { id: string; full_name: string };
type Loan = {
  id: string;
  member_id: string;
  principal_amount: number;
  interest_rate_percent: number;
  duration_meetings: number;
  applied_at: string;
  due_date: string | null;
  status: "applied" | "approved" | "disbursed" | "closed" | "defaulted";
  guarantor_member_id: string | null;
  total_due: number;
  outstanding_balance: number;
  notes: string | null;
};
export function VslaLoansPage({
  readOnly = false,
  onNavigate,
}: {
  readOnly?: boolean;
  onNavigate?: (page: string, state?: Record<string, unknown>) => void;
}) {
  const { user, isSuperAdmin } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!isSuperAdmin;
  const [members, setMembers] = useState<Member[]>([]);
  const [rows, setRows] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [memberId, setMemberId] = useState("");
  const [guarantorId, setGuarantorId] = useState("");
  const [principal, setPrincipal] = useState("0");
  const [interestRate, setInterestRate] = useState("10");
  const [durationMeetings, setDurationMeetings] = useState("4");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [mRes, lRes] = await Promise.all([
      filterByOrganizationId(supabase.from("vsla_members").select("id,full_name").eq("status", "active").order("full_name"), orgId, superAdmin),
      filterByOrganizationId(supabase.from("vsla_loans").select("*").order("applied_at", { ascending: false }), orgId, superAdmin),
    ]);
    if (mRes.error || lRes.error) setError(mRes.error?.message ?? lRes.error?.message ?? "Failed to load loans.");
    setMembers((mRes.data ?? []) as Member[]);
    setRows((lRes.data ?? []) as Loan[]);
    setLoading(false);
  }, [orgId, superAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const memberName = useMemo(() => new Map(members.map((m) => [m.id, m.full_name])), [members]);

  const createLoan = async () => {
    if (readOnly) return;
    const p = Number(principal || 0);
    const ir = Number(interestRate || 0);
    const dur = Number(durationMeetings || 0);
    if (!memberId || p <= 0 || ir < 0 || dur <= 0) {
      setError("Member, principal, interest rate, and duration are required.");
      return;
    }
    const interestAmount = (p * ir) / 100;
    const totalDue = p + interestAmount;
    setSaving(true);
    setError(null);
    const { error: e } = await supabase.from("vsla_loans").insert({
      organization_id: orgId,
      member_id: memberId,
      guarantor_member_id: guarantorId || null,
      principal_amount: p,
      interest_rate_percent: ir,
      duration_meetings: dur,
      due_date: dueDate || null,
      status: "applied",
      total_due: totalDue,
      outstanding_balance: totalDue,
      notes: notes.trim() || null,
    });
    if (e) setError(e.message);
    setSaving(false);
    setPrincipal("0");
    setInterestRate("10");
    setDurationMeetings("4");
    setDueDate("");
    setGuarantorId("");
    setNotes("");
    await load();
  };

  const markStatus = async (loan: Loan, status: Loan["status"]) => {
    if (readOnly) return;
    setSaving(true);
    setError(null);

    const { error: updErr } = await supabase.from("vsla_loans").update({ status }).eq("id", loan.id);
    if (updErr) {
      setError(updErr.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    await load();
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {readOnly && <ReadOnlyNotice />}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">VSLA Loan Management</h1>
        <p className="text-sm text-slate-600 mt-1">Applications and approvals are managed here. Disbursement happens in Meeting Management → Loans tab.</p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Loan Application</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <label className="text-xs text-slate-600">Member
            <select value={memberId} onChange={(e) => setMemberId(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
              <option value="">Select member</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-600">Guarantor (optional)
            <select value={guarantorId} onChange={(e) => setGuarantorId(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
              <option value="">None</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-600">Principal
            <input type="number" value={principal} onChange={(e) => setPrincipal(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="text-xs text-slate-600">Interest % (flat)
            <input type="number" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="text-xs text-slate-600">Duration (meetings)
            <input type="number" value={durationMeetings} onChange={(e) => setDurationMeetings(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="text-xs text-slate-600">Due Date
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="text-xs text-slate-600 md:col-span-2">Notes
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </label>
          <div className="flex items-end">
            <button type="button" onClick={() => void createLoan()} disabled={readOnly || saving} className="px-4 py-2 rounded-lg bg-indigo-700 text-white text-sm disabled:opacity-50">Record Application</button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left p-3">Member</th>
              <th className="text-left p-3">Principal</th>
              <th className="text-left p-3">Interest%</th>
              <th className="text-left p-3">Total Due</th>
              <th className="text-left p-3">Outstanding</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td className="p-4 text-slate-500" colSpan={7}>Loading loans...</td></tr> : rows.length === 0 ? <tr><td className="p-4 text-slate-500" colSpan={7}>No loans yet.</td></tr> : rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-100">
                <td className="p-3">{memberName.get(r.member_id) ?? "Unknown"}</td>
                <td className="p-3">{Number(r.principal_amount || 0).toLocaleString()}</td>
                <td className="p-3">{r.interest_rate_percent}</td>
                <td className="p-3">{Number(r.total_due || 0).toLocaleString()}</td>
                <td className="p-3">{Number(r.outstanding_balance || 0).toLocaleString()}</td>
                <td className="p-3 capitalize">{r.status}</td>
                <td className="p-3">
                  <div className="flex gap-2">
                    <button type="button" className="text-xs text-emerald-700 disabled:opacity-50" disabled={readOnly || saving || r.status !== "applied"} onClick={() => void markStatus(r, "approved")}>Approve</button>
                    <button
                      type="button"
                      className="text-xs text-indigo-700 disabled:opacity-50"
                      disabled={readOnly || r.status !== "approved"}
                      onClick={() =>
                        onNavigate?.(VSLA_PAGE.meetings, {
                          vslaMeetingTab: "loans",
                          vslaDisburseLoanId: r.id,
                        })
                      }
                    >
                      Disburse in Meeting
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
