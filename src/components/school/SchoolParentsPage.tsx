import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";

type ParentRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  phone_alt: string | null;
};

type EditDraft = { full_name: string; email: string; phone: string; phone_alt: string };

type Props = { readOnly?: boolean };

export function SchoolParentsPage({ readOnly }: Props) {
  const { user } = useAuth();
  const [rows, setRows] = useState<ParentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ full_name: "", email: "", phone: "", phone_alt: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const orgId = user?.organization_id;
    if (!orgId) {
      setLoading(false);
      return;
    }
    const { data, error } = await supabase.from("parents").select("*").eq("organization_id", orgId).order("full_name");
    setErr(error?.message || null);
    setRows((data as ParentRow[]) || []);
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
    const { error } = await supabase.from("parents").insert({
      full_name: form.full_name.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      phone_alt: form.phone_alt.trim() || null,
    });
    if (error) setErr(error.message);
    else {
      setForm({ full_name: "", email: "", phone: "", phone_alt: "" });
      load();
    }
  };

  const startEdit = (r: ParentRow) => {
    setEditingId(r.id);
    setEditDraft({
      full_name: r.full_name,
      email: r.email ?? "",
      phone: r.phone ?? "",
      phone_alt: r.phone_alt ?? "",
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
      .from("parents")
      .update({
        full_name: editDraft.full_name.trim(),
        email: editDraft.email.trim() || null,
        phone: editDraft.phone.trim() || null,
        phone_alt: editDraft.phone_alt.trim() || null,
      })
      .eq("id", editingId);
    if (error) setErr(error.message);
    else {
      cancelEdit();
      load();
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Parents / guardians</h1>
        <PageNotes ariaLabel="Parents">
          <p>One parent record can be linked to multiple students from the Students screen or via future bulk import.</p>
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
            placeholder="Alternate phone"
            value={form.phone_alt}
            onChange={(e) => setForm((f) => ({ ...f, phone_alt: e.target.value }))}
          />
          <button type="button" onClick={save} className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-800 w-fit">
            Add parent
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
              <th className="text-left p-3 font-semibold text-slate-700">Alt phone</th>
              {!readOnly && <th className="text-right p-3 font-semibold text-slate-700 w-28">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={readOnly ? 4 : 5} className="p-6 text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={readOnly ? 4 : 5} className="p-6 text-slate-500">
                  No parents yet.
                </td>
              </tr>
            ) : (
              rows.map((r) =>
                editingId === r.id && editDraft ? (
                  <tr key={r.id} className="border-b border-slate-100 bg-indigo-50/40">
                    <td className="p-2" colSpan={readOnly ? 4 : 5}>
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
                          className="border border-slate-300 rounded-md px-2 py-1.5 text-sm md:col-span-2"
                          value={editDraft.phone_alt}
                          onChange={(e) => setEditDraft((d) => (d ? { ...d, phone_alt: e.target.value } : d))}
                          placeholder="Alt phone"
                        />
                        <div className="md:col-span-2 flex justify-end gap-2">
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
                    <td className="p-3 text-slate-600">{r.phone_alt ?? "—"}</td>
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
