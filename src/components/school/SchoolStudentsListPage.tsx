import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import * as XLSX from "xlsx";

type StudentRow = {
  id: string;
  admission_number: string;
  first_name: string;
  last_name: string;
  class_name: string;
  is_boarding: boolean;
};

type EditDraft = {
  admission_number: string;
  first_name: string;
  last_name: string;
  class_name: string;
  is_boarding: boolean;
};

export function StudentsListPage() {
  const { user, isSuperAdmin } = useAuth();
  const canDelete = user?.role === "admin" || isSuperAdmin;
  const [rows, setRows] = useState<StudentRow[]>([]);
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error: loadErr } = await supabase.from("students").select("*");
    if (loadErr) {
      setError(loadErr.message);
      setRows([]);
    } else {
      setRows((data || []) as StudentRow[]);
    }
    setLoading(false);
  };

  const filtered = rows.filter((r) =>
    `${r.first_name} ${r.last_name}`.toLowerCase().includes(search.toLowerCase())
  ).filter((r) =>
    !classFilter || (r.class_name || "").toLowerCase().includes(classFilter.toLowerCase())
  );

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(filtered);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Students");
    XLSX.writeFile(wb, "students.xlsx");
  };

  const startEdit = (r: StudentRow) => {
    setEditingId(r.id);
    setEditDraft({
      admission_number: r.admission_number || "",
      first_name: r.first_name || "",
      last_name: r.last_name || "",
      class_name: r.class_name || "",
      is_boarding: !!r.is_boarding,
    });
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(null);
  };

  const saveEdit = async () => {
    if (!editingId || !editDraft) return;
    if (!editDraft.admission_number.trim() || !editDraft.first_name.trim() || !editDraft.last_name.trim() || !editDraft.class_name.trim()) {
      setError("Admission number, first name, last name, and class are required.");
      return;
    }
    setSaving(true);
    setError(null);
    const { error: saveErr } = await supabase
      .from("students")
      .update({
        admission_number: editDraft.admission_number.trim(),
        first_name: editDraft.first_name.trim(),
        last_name: editDraft.last_name.trim(),
        class_name: editDraft.class_name.trim(),
        is_boarding: editDraft.is_boarding,
      })
      .eq("id", editingId);
    if (saveErr) {
      setError(saveErr.message);
    } else {
      cancelEdit();
      await load();
    }
    setSaving(false);
  };

  const deleteStudent = async (row: StudentRow) => {
    if (!canDelete) {
      setError("Only admin users can delete students.");
      return;
    }
    const confirmed = window.confirm(
      `Delete student "${row.first_name} ${row.last_name}" (${row.admission_number})?\n\nThis action cannot be undone.`
    );
    if (!confirmed) return;

    setError(null);
    const { error: delErr } = await supabase.from("students").delete().eq("id", row.id);
    if (delErr) {
      setError(
        delErr.message ||
          "Failed to delete student. Remove linked records (payments/invoices/parent links) first."
      );
      return;
    }
    await load();
  };

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-bold">Students List</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* FILTERS */}
      <div className="flex gap-2">
        <input
          placeholder="Search name"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border p-2 rounded"
        />

        <input
          placeholder="Filter class"
          value={classFilter}
          onChange={e => setClassFilter(e.target.value)}
          className="border p-2 rounded"
        />

        <button onClick={exportExcel} className="bg-green-600 text-white px-3 py-2 rounded">
          Excel
        </button>

        <button onClick={() => window.print()} className="bg-blue-600 text-white px-3 py-2 rounded">
          Print / PDF
        </button>
      </div>

      {/* TABLE */}
      <table className="w-full border bg-white">
        <thead>
          <tr>
            <th>Admission</th>
            <th>Name</th>
            <th>Class</th>
            <th>Type</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          {loading ? (
            <tr>
              <td colSpan={5} className="p-4 text-slate-500">Loading...</td>
            </tr>
          ) : filtered.length === 0 ? (
            <tr>
              <td colSpan={5} className="p-4 text-slate-500">No students found.</td>
            </tr>
          ) : (
            filtered.map((r) =>
              editingId === r.id && editDraft ? (
                <tr key={r.id} className="border-t bg-indigo-50/40">
                  <td className="p-2">
                    <input
                      value={editDraft.admission_number}
                      onChange={(e) => setEditDraft((d) => (d ? { ...d, admission_number: e.target.value } : d))}
                      className="border p-2 rounded w-full"
                    />
                  </td>
                  <td className="p-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        value={editDraft.first_name}
                        onChange={(e) => setEditDraft((d) => (d ? { ...d, first_name: e.target.value } : d))}
                        className="border p-2 rounded"
                      />
                      <input
                        value={editDraft.last_name}
                        onChange={(e) => setEditDraft((d) => (d ? { ...d, last_name: e.target.value } : d))}
                        className="border p-2 rounded"
                      />
                    </div>
                  </td>
                  <td className="p-2">
                    <input
                      value={editDraft.class_name}
                      onChange={(e) => setEditDraft((d) => (d ? { ...d, class_name: e.target.value } : d))}
                      className="border p-2 rounded w-full"
                    />
                  </td>
                  <td className="p-2">
                    <select
                      value={editDraft.is_boarding ? "boarding" : "day"}
                      onChange={(e) => setEditDraft((d) => (d ? { ...d, is_boarding: e.target.value === "boarding" } : d))}
                      className="border p-2 rounded"
                    >
                      <option value="day">Day</option>
                      <option value="boarding">Boarding</option>
                    </select>
                  </td>
                  <td className="p-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void saveEdit()}
                        disabled={saving}
                        className="bg-slate-900 text-white px-3 py-1.5 rounded text-xs disabled:opacity-60"
                      >
                        {saving ? "Saving..." : "Save"}
                      </button>
                      <button type="button" onClick={cancelEdit} className="border px-3 py-1.5 rounded text-xs">
                        Cancel
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={r.id} className="border-t">
                  <td>{r.admission_number}</td>
                  <td>{r.first_name} {r.last_name}</td>
                  <td>{r.class_name}</td>
                  <td>{r.is_boarding ? "Boarding" : "Day"}</td>
                  <td>
                    <div className="flex items-center gap-3">
                      <button type="button" onClick={() => startEdit(r)} className="text-indigo-700 hover:text-indigo-900 text-xs font-medium">
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={!canDelete}
                        onClick={() => void deleteStudent(r)}
                        title={!canDelete ? "Only admin can delete students" : "Delete student"}
                        className={`text-xs font-medium ${
                          canDelete
                            ? "text-red-700 hover:text-red-900"
                            : "text-slate-400 cursor-not-allowed"
                        }`}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              )
            )
          )}
        </tbody>
      </table>
    </div>
  );
}