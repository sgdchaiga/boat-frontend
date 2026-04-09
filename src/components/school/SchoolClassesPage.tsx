import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";

type Row = {
  id: string;
  name: string;
  code: string | null;
  sort_order: number;
  is_active: boolean;
};

type EditDraft = { name: string; code: string; sort_order: string; is_active: boolean };

type Props = { readOnly?: boolean };

export function SchoolClassesPage({ readOnly }: Props) {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", code: "", sort_order: "0" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const orgId = user?.organization_id;
    if (!orgId) {
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("classes")
      .select("*")
      .eq("organization_id", orgId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    setErr(error?.message || null);
    setRows((data as Row[]) || []);
    setLoading(false);
  }, [user?.organization_id]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (readOnly) return;
    if (!form.name.trim()) {
      setErr("Name is required.");
      return;
    }
    setErr(null);
    const { error } = await supabase.from("classes").insert({
      name: form.name.trim(),
      code: form.code.trim() || null,
      sort_order: Number(form.sort_order) || 0,
    });
    if (error) setErr(error.message);
    else {
      setForm({ name: "", code: "", sort_order: "0" });
      load();
    }
  };

  const startEdit = (r: Row) => {
    setEditingId(r.id);
    setEditDraft({
      name: r.name,
      code: r.code ?? "",
      sort_order: String(r.sort_order),
      is_active: r.is_active,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(null);
  };

  const saveEdit = async () => {
    if (readOnly || !editingId || !editDraft) return;
    if (!editDraft.name.trim()) {
      setErr("Name is required.");
      return;
    }
    setErr(null);
    const { error } = await supabase
      .from("classes")
      .update({
        name: editDraft.name.trim(),
        code: editDraft.code.trim() || null,
        sort_order: Number(editDraft.sort_order) || 0,
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
    <div className="p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Classes</h1>
        <PageNotes ariaLabel="Classes">
          <p>Define class levels or forms (e.g. Form 1, Grade 7). Students and fee structures can link to these records.</p>
        </PageNotes>
      </div>
      {err && <p className="text-red-600 text-sm">{err}</p>}
      {!readOnly && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap gap-3 items-end">
          <input
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm min-w-[180px]"
            placeholder="Name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <input
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-28"
            placeholder="Code"
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
          />
          <input
            type="number"
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-24"
            placeholder="Sort"
            value={form.sort_order}
            onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
          />
          <button type="button" onClick={save} className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-800">
            Add
          </button>
        </div>
      )}
      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left p-3 font-semibold text-slate-700">Name</th>
              <th className="text-left p-3 font-semibold text-slate-700">Code</th>
              <th className="text-right p-3 font-semibold text-slate-700">Sort</th>
              <th className="text-left p-3 font-semibold text-slate-700">Active</th>
              {!readOnly && <th className="text-right p-3 font-semibold text-slate-700 w-36">Actions</th>}
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
                  No classes yet.
                </td>
              </tr>
            ) : (
              rows.map((r) =>
                editingId === r.id && editDraft ? (
                  <tr key={r.id} className="border-b border-slate-100 bg-indigo-50/40">
                    <td className="p-2">
                      <input
                        className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                        value={editDraft.name}
                        onChange={(e) => setEditDraft((d) => (d ? { ...d, name: e.target.value } : d))}
                      />
                    </td>
                    <td className="p-2">
                      <input
                        className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                        value={editDraft.code}
                        onChange={(e) => setEditDraft((d) => (d ? { ...d, code: e.target.value } : d))}
                      />
                    </td>
                    <td className="p-2 text-right">
                      <input
                        type="number"
                        className="w-20 border border-slate-300 rounded-md px-2 py-1.5 text-sm text-right inline-block"
                        value={editDraft.sort_order}
                        onChange={(e) => setEditDraft((d) => (d ? { ...d, sort_order: e.target.value } : d))}
                      />
                    </td>
                    <td className="p-2">
                      <label className="inline-flex items-center gap-2 text-slate-700">
                        <input
                          type="checkbox"
                          checked={editDraft.is_active}
                          onChange={(e) => setEditDraft((d) => (d ? { ...d, is_active: e.target.checked } : d))}
                        />
                        Active
                      </label>
                    </td>
                    <td className="p-2 text-right whitespace-nowrap">
                      <button type="button" onClick={saveEdit} className="px-2.5 py-1 text-xs font-medium bg-slate-900 text-white rounded-md mr-1">
                        Save
                      </button>
                      <button type="button" onClick={cancelEdit} className="px-2.5 py-1 text-xs font-medium text-slate-700 border border-slate-300 rounded-md">
                        Cancel
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                    <td className="p-3 font-medium text-slate-900">{r.name}</td>
                    <td className="p-3 text-slate-600">{r.code ?? "—"}</td>
                    <td className="p-3 text-right text-slate-700">{r.sort_order}</td>
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
