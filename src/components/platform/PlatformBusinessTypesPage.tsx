import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PageNotes } from "@/components/common/PageNotes";

interface BusinessTypeRow {
  id: string;
  code: string;
  name: string;
  is_active?: boolean | null;
  sort_order?: number | null;
}

export function PlatformBusinessTypesPage() {
  const [rows, setRows] = useState<BusinessTypeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<BusinessTypeRow | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [isActive, setIsActive] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await (supabase as any)
        .from("business_types")
        .select("id,code,name,is_active,sort_order")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (res.error) throw res.error;
      setRows((res.data || []) as BusinessTypeRow[]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        msg.toLowerCase().includes("does not exist")
          ? 'Table "business_types" is missing. Create it first, then manage values here.'
          : msg
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openAdd = () => {
    setEditing(null);
    setCode("");
    setName("");
    setSortOrder("0");
    setIsActive(true);
    setShowModal(true);
  };

  const openEdit = (row: BusinessTypeRow) => {
    setEditing(row);
    setCode(row.code || "");
    setName(row.name || "");
    setSortOrder(String(row.sort_order ?? 0));
    setIsActive(row.is_active !== false);
    setShowModal(true);
  };

  const save = async () => {
    if (!code.trim() || !name.trim()) {
      alert("Code and name are required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        code: code.trim().toLowerCase(),
        name: name.trim(),
        sort_order: Number(sortOrder || 0),
        is_active: isActive,
      };
      if (editing) {
        const res = await (supabase as any).from("business_types").update(payload).eq("id", editing.id);
        if (res.error) throw res.error;
      } else {
        const res = await (supabase as any).from("business_types").insert(payload);
        if (res.error) throw res.error;
      }
      setShowModal(false);
      await load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this business type?")) return;
    const res = await (supabase as any).from("business_types").delete().eq("id", id);
    if (res.error) {
      alert(res.error.message || "Failed to delete.");
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900">Business Types</h1>
          <PageNotes ariaLabel="Business types help">
            <p>Manage allowed business categories for organizations.</p>
          </PageNotes>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="inline-flex items-center gap-2 px-4 py-2 bg-brand-800 text-white rounded-lg hover:bg-brand-900"
        >
          <Plus className="w-4 h-4" />
          Add business type
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-slate-600">Loading business types...</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left p-3 font-semibold text-slate-700">Code</th>
                <th className="text-left p-3 font-semibold text-slate-700">Name</th>
                <th className="text-left p-3 font-semibold text-slate-700">Active</th>
                <th className="text-left p-3 font-semibold text-slate-700">Sort</th>
                <th className="p-3 w-28" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="p-3 font-mono text-xs">{r.code}</td>
                  <td className="p-3">{r.name}</td>
                  <td className="p-3">{r.is_active === false ? "No" : "Yes"}</td>
                  <td className="p-3">{r.sort_order ?? 0}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        type="button"
                        onClick={() => openEdit(r)}
                        className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(r.id)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-slate-500">
                    No business types found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl">
            <h2 className="text-lg font-bold text-slate-900 mb-4">
              {editing ? "Edit business type" : "Add business type"}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Code</label>
                <input
                  className="w-full border border-slate-300 rounded-lg px-3 py-2"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="e.g. hotel"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
                <input
                  className="w-full border border-slate-300 rounded-lg px-3 py-2"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Hotel"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Sort order</label>
                <input
                  type="number"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                />
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                Active
              </label>
            </div>
            <div className="flex gap-2 justify-end mt-5">
              <button
                type="button"
                className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg"
                onClick={() => setShowModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                className="px-4 py-2 bg-brand-800 text-white rounded-lg disabled:opacity-50"
                onClick={save}
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
