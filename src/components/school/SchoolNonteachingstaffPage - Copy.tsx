import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";

type Row = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  employee_number: string | null;
  is_active: boolean;
};

type EditDraft = {
  full_name: string;
  email: string;
  phone: string;
  employee_number: string;
  is_active: boolean;
};

type Props = { readOnly?: boolean };

export function SchoolTeachersPage({ readOnly }: Props) {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ full_name: "", email: "", phone: "", employee_number: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const orgId = user?.organization_id;
    if (!orgId) {
      setLoading(false);
      return;
    }
    const { data, error } = await supabase.from("teachers").select("*").eq("organization_id", orgId).order("full_name");
    setErr(error?.message || null);
    setRows((data as Row[]) || []);
    setLoading(false);
  }, [user?.organization_id]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (readOnly) return;
    if (!form.full_name.trim()) {
      setErr("Name is required.");
      return;
    }
    setErr(null);
    const { error } = await supabase.from("teachers").insert({
      full_name: form.full_name.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      employee_number: form.employee_number.trim() || null,
    });
    if (error) setErr(error.message);
    else {
      setForm({ full_name: "", email: "", phone: "", employee_number: "" });
      load();
    }
  };

  const startEdit = (r: Row) => {
    setEditingId(r.id);
    setEditDraft({
      full_name: r.full_name,
      email: r.email ?? "",
      phone: r.phone ?? "",
      employee_number: r.employee_number ?? "",
      is_active: r.is_active,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(null);
  };

  const saveEdit = async () => {
    if (readOnly || !editingId || !editDraft) return;
    if (!editDraft.full_name.trim()) {
      setErr("Name is required.");
      return;
    }
    setErr(null);
    const { error } = await supabase
      .from("teachers")
      .update({
        full_name: editDraft.full_name.trim(),
        email: editDraft.email.trim() || null,
        phone: editDraft.phone.trim() || null,
        employee_number: editDraft.employee_number.trim() || null,
        is_active: editDraft.is_active,
      })
      .eq("id", editingId);
    if (error) setErr(error.message);
    else {
      cancelEdit();
      load();
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Teachers</h1>
        <PageNotes ariaLabel="Teachers">
          <p>
            Teaching staff directory. Optionally link a row to a BOAT <code className="text-xs bg-slate-200 px-1 rounded">staff</code> user later for
            portal access.
          </p>
        </PageNotes>
      </div>
      {err && <p className="text-red-600 text-sm">{err}</p>}
      {!readOnly && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm md:col-span-2"
            placeholder="Full name"
            value={form.full_name}
            onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
          />
          <input
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
          <input
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="Phone"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          />
          <input
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm md:col-span-2"
            placeholder="Employee / payroll number (optional)"
            value={form.employee_number}
            onChange={(e) => setForm((f) => ({ ...f, employee_number: e.target.value }))}
          />
          <button type="button" onClick={save} className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-800 w-fit">
            Add teacher
          </button>
        </div>
      )}
      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left p-3 font-semibold text-slate-700">Name</th>
              <th className="text-left p-3 font-semibold text-slate-700">Email</th>
              <th className="text-left p-3 font-semibold text-slate-700">Phone</th>
              <th className="text-left p-3 font-semibold text-slate-700">Employee #</th>
              <th className="text-left p-3 font-semibold text-slate-700">Active</th>
              {!readOnly && <th className="text-right p-3 font-semibold text-slate-700 w-36">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={readOnly ? 5 : 6} className="p-6 text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={readOnly ? 5 : 6} className="p-6 text-slate-500">
                  No teachers yet.
                </td>
              </tr>
            ) : (
              rows.map((r) =>
                editingId === r.id && editDraft ? (
                  <tr key={r.id} className="border-b border-slate-100 bg-indigo-50/40">
                    <td className="p-2" colSpan={readOnly ? 5 : 6}>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 py-1">
                        <input
                          className="border border-slate-300 rounded-md px-2 py-1.5 text-sm md:col-span-2"
                          value={editDraft.full_name}
                          onChange={(e) => setEditDraft((d) => (d ? { ...d, full_name: e.target.value } : d))}
                          placeholder="Full name"
                        />
                        <input
                          className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                          value={editDraft.email}
                          onChange={(e) => setEditDraft((d) => (d ? { ...d, email: e.target.value } : d))}
                          placeholder="Email"
                        />
                        <input
                          className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                          value={editDraft.phone}
                          onChange={(e) => setEditDraft((d) => (d ? { ...d, phone: e.target.value } : d))}
                          placeholder="Phone"
                        />
                        <input
                          className="border border-slate-300 rounded-md px-2 py-1.5 text-sm md:col-span-2 font-mono text-xs"
                          value={editDraft.employee_number}
                          onChange={(e) => setEditDraft((d) => (d ? { ...d, employee_number: e.target.value } : d))}
                          placeholder="Employee #"
                        />
                        <label className="inline-flex items-center gap-2 text-slate-700 md:col-span-2">
                          <input
                            type="checkbox"
                            checked={editDraft.is_active}
                            onChange={(e) => setEditDraft((d) => (d ? { ...d, is_active: e.target.checked } : d))}
                          />
                          Active
                        </label>
                        <div className="md:col-span-2 flex justify-end gap-2 pt-1">
                          <button type="button" onClick={saveEdit} className="px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-md">
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-md"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                    <td className="p-3 font-medium text-slate-900">{r.full_name}</td>
                    <td className="p-3 text-slate-600">{r.email ?? "—"}</td>
                    <td className="p-3 text-slate-600">{r.phone ?? "—"}</td>
                    <td className="p-3 text-slate-600 font-mono text-xs">{r.employee_number ?? "—"}</td>
                    <td className="p-3 text-slate-600">{r.is_active ? "Yes" : "No"}</td>
                    {!readOnly && (
                      <td className="p-3 text-right">
                        <button
                          type="button"
                          onClick={() => startEdit(r)}
                          className="text-xs font-medium text-indigo-700 hover:text-indigo-900"
                        >
                          Edit
                        </button>
                      </td>
                    )}
                  </tr>
                )
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
