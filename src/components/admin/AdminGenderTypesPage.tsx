import { useEffect, useState } from "react";
import { UsersRound, Plus, XCircle, CheckCircle2, Edit2, Save } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { PageNotes } from "../common/PageNotes";

type GenderType = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  created_at: string;
};

export function AdminGenderTypesPage() {
  const [genders, setGenders] = useState<GenderType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<GenderType | null>(null);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchGenders();
  }, []);

  const fetchGenders = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("gender_types")
      .select("*")
      .order("code");
    if (error) {
      console.error("Error loading gender_types:", error);
      setLoading(false);
      return;
    }
    setGenders((data || []) as GenderType[]);
    setLoading(false);
  };

  const openNew = () => {
    setEditing(null);
    setCode("");
    setName("");
    setShowForm(true);
  };

  const openEdit = (g: GenderType) => {
    setEditing(g);
    setCode(g.code);
    setName(g.name);
    setShowForm(true);
  };

  const saveGender = async () => {
    const trimmedCode = code.trim().toUpperCase();
    const trimmedName = name.trim();
    if (!trimmedCode || trimmedCode.length !== 1) {
      alert("Code must be exactly 1 character.");
      return;
    }
    if (!trimmedName) {
      alert("Enter a name.");
      return;
    }
    setSaving(true);
    try {
      const payload = { code: trimmedCode, name: trimmedName };
      if (editing) {
        const { error } = await supabase.from("gender_types").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("gender_types").insert(payload);
        if (error) throw error;
      }
      setShowForm(false);
      fetchGenders();
    } catch (e) {
      console.error(e);
      alert("Failed to save: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (g: GenderType) => {
    const { error } = await supabase
      .from("gender_types")
      .update({ is_active: !g.is_active })
      .eq("id", g.id);
    if (error) {
      console.error(error);
      alert(error.message);
      return;
    }
    fetchGenders();
  };

  if (loading) {
    return <div className="text-slate-500 py-8">Loading gender types...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="bg-brand-600 p-2.5 rounded-lg shadow-sm">
            <UsersRound className="w-5 h-5 text-white" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Gender Types</h2>
            <PageNotes ariaLabel="Gender types help">
              <p>Manage the list of allowed genders used in profiles and reports.</p>
            </PageNotes>
          </div>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-2 bg-brand-700 text-white px-4 py-2 rounded-lg hover:bg-brand-800"
        >
          <Plus className="w-4 h-4" />
          Add Gender
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="p-3 text-left w-20">Code</th>
              <th className="p-3 text-left">Name</th>
              <th className="p-3 text-center w-24">Active</th>
              <th className="p-3 text-center w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {genders.map((g) => (
              <tr key={g.id} className="border-t border-slate-200">
                <td className="p-3 font-mono">{g.code}</td>
                <td className="p-3">{g.name}</td>
                <td className="p-3 text-center">
                  {g.is_active ? (
                    <CheckCircle2 className="w-4 h-4 text-green-600 inline-block" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-600 inline-block" />
                  )}
                </td>
                <td className="p-3 text-center">
                  <button
                    onClick={() => openEdit(g)}
                    className="text-blue-600 inline-flex items-center gap-1 mr-3"
                  >
                    <Edit2 className="w-4 h-4" />
                    Edit
                  </button>
                  <button
                    onClick={() => toggleActive(g)}
                    className="text-slate-600 text-xs"
                  >
                    {g.is_active ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
            {genders.length === 0 && (
              <tr>
                <td colSpan={4} className="p-6 text-center text-slate-500">
                  No gender types yet. Click &quot;Add Gender&quot; to create one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-xl w-full max-w-md space-y-4">
            <h3 className="text-xl font-bold">
              {editing ? "Edit Gender Type" : "Add Gender Type"}
            </h3>
            <div className="space-y-3">
              <div className="flex gap-4">
                <div className="w-24">
                  <label className="text-sm font-medium mb-1 block">Code</label>
                  <input
                    className="border w-full p-2 rounded text-center font-mono"
                    maxLength={1}
                    value={code}
                    onChange={(e) => setCode(e.target.value.slice(0, 1))}
                    placeholder="M"
                  />
                  <p className="text-xs text-slate-500 mt-1">1 character</p>
                </div>
                <div className="flex-1">
                  <label className="text-sm font-medium mb-1 block">Name</label>
                  <input
                    className="border w-full p-2 rounded"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Male"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 border rounded"
              >
                Cancel
              </button>
              <button
                onClick={saveGender}
                disabled={saving}
                className="px-4 py-2 bg-brand-700 text-white rounded flex items-center gap-2 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

