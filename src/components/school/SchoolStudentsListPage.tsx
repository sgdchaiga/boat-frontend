import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import * as XLSX from "xlsx";
import { canUseSchoolApi, listSchoolRows, updateSchoolRow } from "@/lib/schoolApiData";
import { toSchoolTitleCase } from "@/lib/schoolTextCase";
import { fetchAllPages } from "@/lib/supabasePagination";

type StudentRow = {
  id: string;
  admission_number: string;
  first_name: string;
  last_name: string;
  class_name: string;
  is_boarding: boolean;
  status: string;
  school_pay_number: string | null;
};

type EditDraft = {
  admission_number: string;
  first_name: string;
  last_name: string;
  class_name: string;
  is_boarding: boolean;
};

function normalizeStudentCase(row: StudentRow): StudentRow {
  return {
    ...row,
    first_name: toSchoolTitleCase(row.first_name),
    last_name: toSchoolTitleCase(row.last_name),
    class_name: toSchoolTitleCase(row.class_name),
  };
}

export function StudentsListPage() {
  const { user, isSuperAdmin } = useAuth();
  const canDelete = user?.role === "admin" || isSuperAdmin;
  const canEditSchoolPay = user?.role === "admin" || user?.role === "super_admin" || isSuperAdmin;
  const [schoolPayEditingId, setSchoolPayEditingId] = useState<string | null>(null);
  const [schoolPayDraft, setSchoolPayDraft] = useState("");
  const [schoolPaySaving, setSchoolPaySaving] = useState(false);
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
    const orgId = user?.organization_id;
    if (canUseSchoolApi() && orgId) {
      try {
        const data = await listSchoolRows<StudentRow>("students", orgId);
        setRows(data.map(normalizeStudentCase));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load students.");
        setRows([]);
      } finally {
        setLoading(false);
      }
      return;
    }
    try {
      const data = await fetchAllPages<StudentRow>((from, to) => {
        let query = supabase.from("students").select("*").order("id").range(from, to);
        if (orgId) query = query.eq("organization_id", orgId);
        return query;
      });
      setRows(data.map(normalizeStudentCase));
    } catch (loadErr) {
      setError(loadErr instanceof Error ? loadErr.message : "Failed to load students.");
      setRows([]);
    }
    setLoading(false);
  };

  const filtered = rows.filter((r) =>
    `${r.first_name} ${r.last_name} ${r.admission_number} ${r.school_pay_number || ""}`.toLowerCase().includes(search.toLowerCase())
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
    if (schoolPaySaving) return;
    setSchoolPayEditingId(null);
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
    const payload = {
      admission_number: editDraft.admission_number.trim(),
      first_name: toSchoolTitleCase(editDraft.first_name),
      last_name: toSchoolTitleCase(editDraft.last_name),
      class_name: toSchoolTitleCase(editDraft.class_name),
      is_boarding: editDraft.is_boarding,
    };
    if (canUseSchoolApi() && user?.organization_id) {
      try {
        await updateSchoolRow<StudentRow>("students", user.organization_id, editingId, payload);
        cancelEdit();
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update student.");
      } finally {
        setSaving(false);
      }
      return;
    }
    const { error: saveErr } = await supabase
      .from("students")
      .update(payload)
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
    if (canUseSchoolApi()) {
      setError("Deleting students through the BOAT API is not enabled yet. Archive or delete linked records from the server tools.");
      return;
    }
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

  const saveSchoolPay = async (row: StudentRow) => {
    if (!canEditSchoolPay || schoolPaySaving) return;
    const orgId = user?.organization_id;
    if (!orgId) {
      setError("Select a school before updating a SchoolPay code.");
      return;
    }
    const code = schoolPayDraft.trim() || null;
    if (code && rows.some((student) => student.id !== row.id && student.school_pay_number === code)) {
      setError("That SchoolPay code is already assigned to another student.");
      return;
    }
    setSchoolPaySaving(true);
    setError(null);
    try {
      const payload = { school_pay_number: code };
      if (canUseSchoolApi()) {
        await updateSchoolRow<StudentRow>("students", orgId, row.id, payload);
      } else {
        const { error: saveError } = await supabase.from("students")
          .update(payload).eq("id", row.id).eq("organization_id", orgId).select("id").single();
        if (saveError) throw saveError;
      }
      setRows((current) => current.map((student) => student.id === row.id
        ? { ...student, school_pay_number: code } : student));
      setSchoolPayEditingId(null);
    } catch (err) {
      setError(err && typeof err === "object" && "message" in err
        ? String(err.message) : "Failed to update SchoolPay code.");
    } finally {
      setSchoolPaySaving(false);
    }
  };

  const schoolPayCell = (row: StudentRow) => (
    <td className="p-2">
      {schoolPayEditingId === row.id && canEditSchoolPay ? (
        <form className="flex items-center gap-2" onSubmit={(event) => {
          event.preventDefault();
          void saveSchoolPay(row);
        }}>
          <input
            autoFocus
            type="text"
            aria-label={`SchoolPay code for ${row.first_name} ${row.last_name}`}
            value={schoolPayDraft}
            disabled={schoolPaySaving}
            onChange={(event) => setSchoolPayDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !schoolPaySaving) setSchoolPayEditingId(null);
            }}
            className="border p-2 rounded w-40"
          />
          <button type="submit" disabled={schoolPaySaving} className="bg-slate-900 text-white px-3 py-1.5 rounded text-xs disabled:opacity-60">
            {schoolPaySaving ? "Saving..." : "Save"}
          </button>
          <button type="button" disabled={schoolPaySaving} onClick={() => setSchoolPayEditingId(null)} className="border px-3 py-1.5 rounded text-xs disabled:opacity-60">Cancel</button>
        </form>
      ) : (
        <div className="flex items-center gap-2">
          <span>{row.school_pay_number || "—"}</span>
          {canEditSchoolPay && (
            <button type="button" disabled={schoolPaySaving || saving} onClick={() => {
              cancelEdit();
              setSchoolPayEditingId(row.id);
              setSchoolPayDraft(row.school_pay_number || "");
              setError(null);
            }} aria-label={`Edit SchoolPay code for ${row.first_name} ${row.last_name}`} className="text-indigo-700 hover:text-indigo-900 text-xs font-medium disabled:opacity-60 print:hidden">
              {row.school_pay_number ? "Edit" : "Add code"}
            </button>
          )}
        </div>
      )}
    </td>
  );

  const markAsLeft = async (row: StudentRow) => {
    if (!window.confirm(`Mark ${row.first_name} ${row.last_name} as having left the school?`)) return;
    setError(null);
    try {
      if (canUseSchoolApi() && user?.organization_id) {
        await updateSchoolRow<StudentRow>("students", user.organization_id, row.id, { status: "left" });
      } else {
        const { error: statusErr } = await supabase.from("students").update({ status: "left" }).eq("id", row.id);
        if (statusErr) throw statusErr;
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update student status.");
    }
  };

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-bold">Students List</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* FILTERS */}
      <div className="flex gap-2">
        <input
          placeholder="Search name, admission or SchoolPay"
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
            <th>Status</th>
            <th>SchoolPay code</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          {loading ? (
            <tr>
              <td colSpan={7} className="p-4 text-slate-500">Loading...</td>
            </tr>
          ) : filtered.length === 0 ? (
            <tr>
              <td colSpan={7} className="p-4 text-slate-500">No students found.</td>
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
                  <td className="p-2 capitalize">{r.status || "active"}</td>
                  {schoolPayCell(r)}
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
                  <td className="capitalize">{r.status || "active"}</td>
                  {schoolPayCell(r)}
                  <td>
                    <div className="flex items-center gap-3">
                      <button type="button" onClick={() => startEdit(r)} className="text-indigo-700 hover:text-indigo-900 text-xs font-medium">
                        Edit
                      </button>
                      {r.status !== "left" && (
                        <button type="button" onClick={() => void markAsLeft(r)} className="ml-5 border-l border-slate-300 pl-5 text-amber-700 hover:text-amber-900 text-xs font-medium">
                          Mark as left
                        </button>
                      )}
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
