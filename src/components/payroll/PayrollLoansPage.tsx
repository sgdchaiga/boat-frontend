import { useCallback, useEffect, useMemo, useState } from "react";
import { getPayrollAccess } from "@/lib/payrollAccess";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PayrollGuide } from "@/components/payroll/PayrollGuide";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";

type StaffOpt = { id: string; full_name: string };
type LoanRow = {
  id: string;
  staff_id: string;
  reference: string | null;
  principal_amount: number;
  balance_remaining: number;
  installment_amount: number;
  is_active: boolean;
};

type Props = { readOnly?: boolean };

export function PayrollLoansPage({ readOnly }: Props) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const payrollAccess = useMemo(() => getPayrollAccess(user?.role, readOnly ?? false), [user?.role, readOnly]);
  const [staff, setStaff] = useState<StaffOpt[]>([]);
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    staff_id: "",
    reference: "",
    principal_amount: "",
    balance_remaining: "",
    installment_amount: "",
  });

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

  const addLoan = async () => {
    if (readOnly || !orgId || !form.staff_id || !payrollAccess.canPrepare) return;
    const p = Number(form.principal_amount);
    const b = Number(form.balance_remaining);
    const i = Number(form.installment_amount);
    if (!(p > 0 && b >= 0 && i >= 0)) {
      setErr("Enter valid principal, balance, and installment.");
      return;
    }
    setErr(null);
    const { error } = await supabase.from("payroll_loans").insert({
      staff_id: form.staff_id,
      reference: form.reference.trim() || null,
      principal_amount: p,
      balance_remaining: b,
      installment_amount: i,
      is_active: true,
    });
    if (error) setErr(error.message);
    setForm({ staff_id: "", reference: "", principal_amount: "", balance_remaining: "", installment_amount: "" });
    load();
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
          <input
            type="number"
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="Balance remaining"
            value={form.balance_remaining}
            onChange={(e) => setForm((f) => ({ ...f, balance_remaining: e.target.value }))}
          />
          <input
            type="number"
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm md:col-span-2"
            placeholder="Monthly installment"
            value={form.installment_amount}
            onChange={(e) => setForm((f) => ({ ...f, installment_amount: e.target.value }))}
          />
          <button type="button" onClick={() => void addLoan()} className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-800 w-fit md:col-span-2">
            Add loan
          </button>
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
                <th className="text-left p-3 font-semibold text-slate-700">Active</th>
              </tr>
            </thead>
            <tbody>
              {loans.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-6 text-slate-500">
                    No loans.
                  </td>
                </tr>
              ) : (
                loans.map((l) => (
                  <tr key={l.id} className="border-b border-slate-100">
                    <td className="p-3">{staff.find((s) => s.id === l.staff_id)?.full_name ?? l.staff_id}</td>
                    <td className="p-3 text-right">{Number(l.balance_remaining).toLocaleString()}</td>
                    <td className="p-3 text-right">{Number(l.installment_amount).toLocaleString()}</td>
                    <td className="p-3 text-slate-600">{l.is_active ? "Yes" : "No"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
