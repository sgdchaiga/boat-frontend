import { useCallback, useEffect, useMemo, useState } from "react";
import { getPayrollAccess } from "@/lib/payrollAccess";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PayrollGuide } from "@/components/payroll/PayrollGuide";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";

type PeriodRow = {
  id: string;
  label: string;
  period_start: string;
  period_end: string;
  status: string;
};

type Props = { readOnly?: boolean };

export function PayrollPeriodsPage({ readOnly }: Props) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const payrollAccess = useMemo(() => getPayrollAccess(user?.role, readOnly ?? false), [user?.role, readOnly]);
  const [rows, setRows] = useState<PeriodRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ label: "", period_start: "", period_end: "" });

  const load = useCallback(async () => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("payroll_periods")
      .select("*")
      .eq("organization_id", orgId)
      .order("period_start", { ascending: false });
    setErr(error?.message || null);
    setRows((data as PeriodRow[]) || []);
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const addPeriod = async () => {
    if (readOnly || !form.label || !form.period_start || !form.period_end || !payrollAccess.canPrepare) return;
    setErr(null);
    const { error } = await supabase.from("payroll_periods").insert({
      label: form.label.trim(),
      period_start: form.period_start,
      period_end: form.period_end,
      status: "open",
    });
    if (error) setErr(error.message);
    setForm({ label: "", period_start: "", period_end: "" });
    load();
  };

  if (!orgId) return <p className="p-6 text-slate-600">No organization.</p>;

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Payroll periods</h1>
        <PayrollGuide guideId="periods" />
      </div>
      {readOnly && <ReadOnlyNotice />}
      {!readOnly && !payrollAccess.canPrepare && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Your role cannot add periods. Grant payroll prepare access under Admin → Approval rights.
        </p>
      )}
      {err && <p className="text-red-600 text-sm">{err}</p>}
      {!readOnly && payrollAccess.canPrepare && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 grid grid-cols-1 md:grid-cols-3 gap-2">
          <input
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm md:col-span-3"
            placeholder="Label (e.g. March 2026)"
            value={form.label}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
          />
          <input
            type="date"
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            value={form.period_start}
            onChange={(e) => setForm((f) => ({ ...f, period_start: e.target.value }))}
          />
          <input
            type="date"
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            value={form.period_end}
            onChange={(e) => setForm((f) => ({ ...f, period_end: e.target.value }))}
          />
          <button type="button" onClick={() => void addPeriod()} className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-800">
            Add period
          </button>
        </div>
      )}
      {loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : (
        <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left p-3 font-semibold text-slate-700">Label</th>
                <th className="text-left p-3 font-semibold text-slate-700">From</th>
                <th className="text-left p-3 font-semibold text-slate-700">To</th>
                <th className="text-left p-3 font-semibold text-slate-700">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="p-3 font-medium text-slate-900">{r.label}</td>
                  <td className="p-3 text-slate-700">{r.period_start}</td>
                  <td className="p-3 text-slate-700">{r.period_end}</td>
                  <td className="p-3 capitalize text-slate-600">{r.status}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-6 text-slate-500">
                    No periods yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
