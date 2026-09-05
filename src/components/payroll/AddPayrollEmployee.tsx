import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { payrollStaffTypes } from "@/lib/payrollBusiness";

export function AddPayrollEmployee({ businessType, onCreated, onCancel }: {
  businessType?: string | null; onCreated: (id: string) => Promise<void>; onCancel: () => void;
}) {
  const [draft, setDraft] = useState({ name: "", code: "", department: "", job: "", type: "", joined: "", email: "", phone: "", salary: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);
  const update = (key: keyof typeof draft, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const save = async () => {
    if (busy) return;
    if (!draft.name.trim() || !draft.code.trim()) { setError("Enter the employee's full name and a unique employee code."); return; }
    const salary = Number(draft.salary || 0);
    if (!Number.isFinite(salary) || salary < 0) { setError("Base salary must be zero or greater."); return; }
    setBusy(true); setError("");
    try {
      let id = createdId;
      if (!id) {
        const { data, error: createError } = await supabase.rpc("create_payroll_employee", {
          p_full_name: draft.name.trim(), p_employee_code: draft.code.trim(), p_department: draft.department.trim() || null,
          p_job_title: draft.job.trim() || null, p_staff_type: draft.type || null, p_date_joined: draft.joined || null,
          p_email: draft.email.trim() || null, p_phone: draft.phone.trim() || null, p_base_salary: salary,
        });
        if (createError) throw createError;
        id = String(data); setCreatedId(id);
      }
      await onCreated(id);
    } catch (err) { setError((err as { message?: string }).message || "Unable to add the employee."); }
    finally { setBusy(false); }
  };
  return <form className="rounded-xl border border-blue-200 bg-blue-50/40 p-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
    <h2 className="font-semibold text-slate-900">Add employee</h2>
    <p className="mt-1 text-sm text-slate-600">Create an employee and payroll profile. This does not create a BOAT login.</p>
    <fieldset disabled={busy || !!createdId} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {([
        ["name", "Full name", "text"], ["code", "Employee code", "text"], ["department", "Department", "text"],
        ["job", "Job title", "text"], ["joined", "Date joined", "date"], ["email", "Email (optional)", "email"],
        ["phone", "Phone (optional)", "tel"], ["salary", "Base salary", "number"],
      ] as const).map(([key, label, type]) => <label key={key} className="block text-sm text-slate-700">{label}<input type={type} required={key === "name" || key === "code"} min={type === "number" ? 0 : undefined} step={type === "number" ? "0.01" : undefined} value={draft[key]} onChange={(e) => update(key, e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" /></label>)}
      <label className="block text-sm text-slate-700">Staff type<select value={draft.type} onChange={(e) => update("type", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"><option value="">Select staff type</option>{payrollStaffTypes(businessType).map((type) => <option key={type}>{type}</option>)}</select></label>
    </fieldset>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    <div className="mt-4 flex gap-3"><button type="submit" disabled={busy} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : createdId ? "Reload employee" : "Add employee"}</button><button type="button" disabled={busy} onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">{createdId ? "Close" : "Cancel"}</button></div>
  </form>;
}
