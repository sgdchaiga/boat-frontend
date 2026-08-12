import { useCallback, useEffect, useMemo, useState } from "react";
import { getPayrollAccess } from "@/lib/payrollAccess";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PayrollGuide } from "@/components/payroll/PayrollGuide";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";
import { cancelPayrollLoanDisbursement, postPayrollLoanDisbursement } from "@/lib/payrollLoanJournal";
import { buildPayrollLoanSchedule, payrollLoanTotalRepayable, type PayrollLoanInterestMethod } from "@/lib/payrollLoanSchedule";

type StaffOpt = { id: string; full_name: string };
type LoanRow = {
  id: string;
  staff_id: string;
  reference: string | null;
  principal_amount: number;
  balance_remaining: number;
  installment_amount: number;
  is_active: boolean;
  interest_rate_pct: number;
  interest_method: PayrollLoanInterestMethod;
  term_months: number;
  total_repayable: number;
  status: "active" | "completed" | "cancelled";
};

const emptyForm = { staff_id: "", reference: "", principal_amount: "", balance_remaining: "", installment_amount: "", interest_rate_pct: "0", interest_method: "flat" as PayrollLoanInterestMethod, term_months: "1" };

type Props = { readOnly?: boolean };

export function PayrollLoansPage({ readOnly }: Props) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const payrollAccess = useMemo(() => getPayrollAccess(user?.role, readOnly ?? false), [user?.role, readOnly]);
  const [staff, setStaff] = useState<StaffOpt[]>([]);
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [scheduleId, setScheduleId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [sRes, lRes] = await Promise.all([
      supabase.from("staff").select("id,full_name").eq("organization_id", orgId).order("full_name"),
      supabase.from("payroll_loans").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }),
    ]);
    setErr(sRes.error?.message || lRes.error?.message || null);
    setStaff((sRes.data as StaffOpt[]) || []);
    setLoans((lRes.data as LoanRow[]) || []);
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const saveLoan = async () => {
    if (readOnly || !orgId || !form.staff_id || !payrollAccess.canPrepare) return;
    const p = Number(form.principal_amount);
    const rate = Math.max(0, Number(form.interest_rate_pct) || 0);
    const term = Math.max(1, Math.trunc(Number(form.term_months) || 1));
    const totalRepayable = payrollLoanTotalRepayable(p, rate, term, form.interest_method);
    // A new loan starts with its full principal outstanding unless an opening
    // balance is explicitly supplied (for example, during data migration).
    const existing = loans.find((loan) => loan.id === editingId);
    const alreadyRecovered = existing ? Math.max(0, Number(existing.total_repayable || existing.principal_amount) - Number(existing.balance_remaining)) : 0;
    const b = form.balance_remaining.trim() === "" ? Math.max(0, totalRepayable - alreadyRecovered) : Number(form.balance_remaining);
    const i = form.installment_amount.trim() === "" ? roundInstallment(totalRepayable / term) : Number(form.installment_amount);
    if (!(p > 0 && b > 0 && i > 0)) {
      setErr("Principal, outstanding balance, and monthly installment must be greater than zero.");
      return;
    }
    setErr(null);
    const payload = {
      staff_id: form.staff_id,
      reference: form.reference.trim() || null,
      principal_amount: p,
      balance_remaining: b,
      installment_amount: i,
      interest_rate_pct: rate,
      interest_method: form.interest_method,
      term_months: term,
      total_repayable: totalRepayable,
      is_active: b > 0,
      status: b > 0 ? "active" : "completed",
    };
    const result = editingId
      ? await supabase.from("payroll_loans").update(payload).eq("id", editingId).select("id").single()
      : await supabase.from("payroll_loans").insert(payload).select("id").single();
    const { data: loan, error } = result;
    if (error) {
      setErr(error.message);
      return;
    }
    const journal = await postPayrollLoanDisbursement({
      organizationId: orgId,
      staffUserId: user?.id ?? null,
      loanId: loan.id,
      staffId: form.staff_id,
      amount: p,
      totalRepayable,
      reference: form.reference.trim() || null,
    });
    if (!journal.ok) setErr(`Loan saved, but GL posting failed: ${journal.error}`);
    setForm(emptyForm);
    setEditingId(null);
    load();
  };

  const editLoan = (loan: LoanRow) => {
    setEditingId(loan.id);
    setForm({ staff_id: loan.staff_id, reference: loan.reference || "", principal_amount: String(loan.principal_amount), balance_remaining: String(loan.balance_remaining), installment_amount: String(loan.installment_amount), interest_rate_pct: String(loan.interest_rate_pct || 0), interest_method: loan.interest_method || "flat", term_months: String(loan.term_months || 1) });
  };

  const cancelLoan = async (loan: LoanRow) => {
    if (!orgId) return;
    const recovered = Math.max(0, Number(loan.total_repayable || loan.principal_amount) - Number(loan.balance_remaining));
    if (recovered > 0.01) { setErr("This loan already has payroll recoveries and cannot be cancelled. Complete or adjust it instead."); return; }
    if (!window.confirm("Cancel this loan and remove its disbursement from the GL?")) return;
    const retired = await cancelPayrollLoanDisbursement(orgId, loan.id);
    if (!retired.ok) { setErr(retired.error); return; }
    const { error } = await supabase.from("payroll_loans").update({ status: "cancelled", is_active: false, cancelled_at: new Date().toISOString(), cancelled_by: user?.id ?? null }).eq("id", loan.id);
    setErr(error?.message || null); await load();
  };

  if (!orgId) return <p className="p-6 text-slate-600">No organization.</p>;

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Payroll loans & advances</h1>
        <PayrollGuide guideId="loans" />
      </div>
      {readOnly && <ReadOnlyNotice />}
      {!readOnly && !payrollAccess.canPrepare && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Your role cannot add or change loans. Grant payroll prepare access under Admin → Approval rights.
        </p>
      )}
      {err && <p className="text-red-600 text-sm">{err}</p>}
      {!readOnly && payrollAccess.canPrepare && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 grid grid-cols-1 md:grid-cols-2 gap-2">
          <select
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm md:col-span-2"
            value={form.staff_id}
            onChange={(e) => setForm((f) => ({ ...f, staff_id: e.target.value }))}
          >
            <option value="">Staff member</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </select>
          <input
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm md:col-span-2"
            placeholder="Reference"
            value={form.reference}
            onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
          />
          <input
            type="number"
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="Principal"
            value={form.principal_amount}
            onChange={(e) => setForm((f) => ({ ...f, principal_amount: e.target.value }))}
          />
          <select className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={form.interest_method} onChange={(e) => setForm((f) => ({ ...f, interest_method: e.target.value as PayrollLoanInterestMethod }))}>
            <option value="flat">Flat interest</option><option value="declining">Declining balance</option>
          </select>
          <input type="number" min="0" step="0.01" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="Annual interest %" value={form.interest_rate_pct} onChange={(e) => setForm((f) => ({ ...f, interest_rate_pct: e.target.value }))} />
          <input type="number" min="1" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="Term (months)" value={form.term_months} onChange={(e) => setForm((f) => ({ ...f, term_months: e.target.value }))} />
          <input
            type="number"
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="Outstanding balance (defaults to principal)"
            value={form.balance_remaining}
            onChange={(e) => setForm((f) => ({ ...f, balance_remaining: e.target.value }))}
          />
          <input
            type="number"
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm md:col-span-2"
            placeholder="Monthly installment (auto if blank)"
            value={form.installment_amount}
            onChange={(e) => setForm((f) => ({ ...f, installment_amount: e.target.value }))}
          />
          <button type="button" onClick={() => void saveLoan()} className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-800 w-fit">
            {editingId ? "Save changes" : "Add loan"}
          </button>
          {editingId && <button type="button" onClick={() => { setEditingId(null); setForm(emptyForm); }} className="px-4 py-2 border rounded-lg text-sm w-fit">Cancel editing</button>}
        </div>
      )}
      {loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : (
        <div className="rounded-xl border border-slate-200 overflow-x-auto bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left p-3 font-semibold text-slate-700">Staff</th>
                <th className="text-right p-3 font-semibold text-slate-700">Balance</th>
                <th className="text-right p-3 font-semibold text-slate-700">Installment</th>
                <th className="text-left p-3 font-semibold text-slate-700">Interest</th><th className="text-left p-3 font-semibold text-slate-700">Status</th><th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {loans.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-slate-500">
                    No loans.
                  </td>
                </tr>
              ) : (
                loans.map((l) => (<>
                  <tr key={l.id} className="border-b border-slate-100">
                    <td className="p-3">{staff.find((s) => s.id === l.staff_id)?.full_name ?? l.staff_id}</td>
                    <td className="p-3 text-right">{Number(l.balance_remaining).toLocaleString()}</td>
                    <td className="p-3 text-right">{Number(l.installment_amount).toLocaleString()}</td>
                    <td className="p-3 text-slate-600">{Number(l.interest_rate_pct || 0)}% · {l.interest_method || "flat"}</td>
                    <td className="p-3 text-slate-600 capitalize">{l.status || (l.is_active ? "active" : "completed")}</td>
                    <td className="p-3 whitespace-nowrap"><button className="text-indigo-700 mr-3" onClick={() => editLoan(l)}>Edit</button><button className="text-sky-700 mr-3" onClick={() => setScheduleId(scheduleId === l.id ? null : l.id)}>Schedule</button>{(l.status || "active") === "active" && <button className="text-red-700" onClick={() => void cancelLoan(l)}>Cancel</button>}</td>
                  </tr>
                  {scheduleId === l.id && <tr key={`${l.id}-schedule`}><td colSpan={6} className="p-3 bg-slate-50"><LoanSchedule loan={l} /></td></tr>}
                </>))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function roundInstallment(value: number) { return Math.round(value * 100) / 100; }
function LoanSchedule({ loan }: { loan: LoanRow }) {
  const rows = buildPayrollLoanSchedule(loan.principal_amount, loan.interest_rate_pct || 0, loan.term_months || 1, loan.interest_method || "flat");
  return <div className="overflow-x-auto"><p className="font-medium mb-2">Repayment schedule · Total {rows.reduce((s, r) => s + r.payment, 0).toLocaleString()}</p><table className="w-full text-xs"><thead><tr><th className="text-left p-2">#</th><th className="text-right p-2">Opening</th><th className="text-right p-2">Principal</th><th className="text-right p-2">Interest</th><th className="text-right p-2">Payment</th><th className="text-right p-2">Closing</th></tr></thead><tbody>{rows.map(r => <tr key={r.installment} className="border-t"><td className="p-2">{r.installment}</td>{[r.openingBalance,r.principal,r.interest,r.payment,r.closingBalance].map((v,i)=><td key={i} className="p-2 text-right">{v.toLocaleString()}</td>)}</tr>)}</tbody></table></div>;
}
