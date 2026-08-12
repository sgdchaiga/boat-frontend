import { useCallback, useEffect, useMemo, useState } from "react";
import { getPayrollAccess } from "@/lib/payrollAccess";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PayrollGuide } from "@/components/payroll/PayrollGuide";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";
import { Pencil, Save, X } from "lucide-react";

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
  const [editing, setEditing] = useState<PeriodRow | null>(null);
  const [saving, setSaving] = useState(false);

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

  const savePeriod = async () => {
    if (!editing || readOnly || !payrollAccess.canPrepare || saving) return;
    if (!editing.label.trim() || !editing.period_start || !editing.period_end) return setErr("Enter a label and both dates.");
    if (editing.period_end < editing.period_start) return setErr("Period end cannot be before period start.");
    setSaving(true);
    setErr(null);
    const { data: linkedRuns, error: runError } = await supabase
      .from("payroll_runs")
      .select("status,approved_at")
      .eq("payroll_period_id", editing.id);
    if (runError) {
      setErr(runError.message);
      setSaving(false);
      return;
    }
    const locked = ((linkedRuns || []) as Array<{ status: string; approved_at?: string | null }>).some(
      (run) => run.status === "posted" || Boolean(run.approved_at)
    );
    if (locked) {
      setErr("This period cannot be changed because its payroll has been approved or posted.");
      setSaving(false);
      return;
    }
    const { error } = await supabase.from("payroll_periods").update({
      label: editing.label.trim(),
      period_start: editing.period_start,
      period_end: editing.period_end,
    }).eq("id", editing.id).eq("organization_id", orgId);
    if (error) setErr(error.message);
    else setEditing(null);
    setSaving(false);
    await load();
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
                <th className="text-right p-3 font-semibold text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="p-3 font-medium text-slate-900">{editing?.id === r.id ? <input className="w-full border rounded-lg px-2 py-1.5" value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} /> : r.label}</td>
                  <td className="p-3 text-slate-700">{editing?.id === r.id ? <input type="date" className="border rounded-lg px-2 py-1.5" value={editing.period_start} onChange={(e) => setEditing({ ...editing, period_start: e.target.value })} /> : r.period_start}</td>
                  <td className="p-3 text-slate-700">{editing?.id === r.id ? <input type="date" className="border rounded-lg px-2 py-1.5" value={editing.period_end} onChange={(e) => setEditing({ ...editing, period_end: e.target.value })} /> : r.period_end}</td>
                  <td className="p-3 capitalize text-slate-600">{r.status}</td>
                  <td className="p-3"><div className="flex justify-end gap-1">{editing?.id === r.id ? <><button type="button" disabled={saving} onClick={() => void savePeriod()} className="p-2 text-emerald-700 hover:bg-emerald-50 rounded-lg" title="Save"><Save className="w-4 h-4" /></button><button type="button" onClick={() => setEditing(null)} className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg" title="Cancel"><X className="w-4 h-4" /></button></> : <button type="button" disabled={readOnly || !payrollAccess.canPrepare} onClick={() => setEditing({ ...r })} className="p-2 text-slate-700 hover:bg-slate-100 rounded-lg disabled:opacity-30" title="Edit period"><Pencil className="w-4 h-4" /></button>}</div></td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-slate-500">
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
