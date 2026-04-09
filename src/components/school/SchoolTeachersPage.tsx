import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";

type Department = {
  id: string;
  name: string;
};

type Row = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  employee_number: string | null;
  is_active: boolean;
  staff_type: string | null;
  department_id: string | null;
  role_assignment: string | null;
  date_joined: string | null;
  department?: Department;
};

type EditDraft = {
  full_name: string;
  email: string;
  phone: string;
  employee_number: string;
  is_active: boolean;
  staff_type: string;
  department_id: string;
  role_assignment: string;
  date_joined: string;
};

type Props = { readOnly?: boolean };

export function SchoolTeachersPage({ readOnly }: Props) {
  const { user } = useAuth();

  const [rows, setRows] = useState<Row[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [form, setForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    employee_number: "",
    staff_type: "",
    department_id: "",
    role_assignment: "",
    date_joined: "",
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);

  // LOAD TEACHERS
  const load = useCallback(async () => {
    setLoading(true);
    const orgId = user?.organization_id;
    if (!orgId) return;

    const { data, error } = await supabase
      .from("teachers")
      .select("*, department:departments(*)")
      .eq("organization_id", orgId)
      .order("full_name");

    setErr(error?.message || null);
    setRows((data as Row[]) || []);
    setLoading(false);
  }, [user?.organization_id]);

  // LOAD DEPARTMENTS
  const loadDepartments = useCallback(async () => {
    const orgId = user?.organization_id;
    if (!orgId) return;

    const { data } = await supabase
      .from("departments")
      .select("*")
      .eq("organization_id", orgId)
      .order("name");

    setDepartments(data || []);
  }, [user?.organization_id]);

  useEffect(() => {
    load();
    loadDepartments();
  }, [load, loadDepartments]);

  // SAVE NEW
  const save = async () => {
    if (readOnly) return;

    if (!form.full_name.trim()) {
      setErr("Name is required.");
      return;
    }

    const { error } = await supabase.from("teachers").insert({
      full_name: form.full_name.trim(),
      email: form.email || null,
      phone: form.phone || null,
      employee_number: form.employee_number || null,
      staff_type: form.staff_type || null,
      department_id: form.department_id || null,
      role_assignment: form.role_assignment || null,
      date_joined: form.date_joined || null,
    });

    if (error) setErr(error.message);
    else {
      setForm({
        full_name: "",
        email: "",
        phone: "",
        employee_number: "",
        staff_type: "",
        department_id: "",
        role_assignment: "",
        date_joined: "",
      });
      load();
    }
  };

  // START EDIT
  const startEdit = (r: Row) => {
    setEditingId(r.id);
    setEditDraft({
      full_name: r.full_name,
      email: r.email ?? "",
      phone: r.phone ?? "",
      employee_number: r.employee_number ?? "",
      is_active: r.is_active,
      staff_type: r.staff_type ?? "",
      department_id: r.department_id ?? "",
      role_assignment: r.role_assignment ?? "",
      date_joined: r.date_joined ?? "",
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(null);
  };

  // SAVE EDIT
  const saveEdit = async () => {
    if (!editDraft || !editingId) return;

    const { error } = await supabase
      .from("teachers")
      .update({
        ...editDraft,
      })
      .eq("id", editingId);

    if (error) setErr(error.message);
    else {
      cancelEdit();
      load();
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">School Staff</h1>

      {err && <p className="text-red-600">{err}</p>}

      {/* CREATE FORM */}
      {!readOnly && (
        <div className="grid md:grid-cols-3 gap-3 border p-4 rounded-xl bg-white">
          <input
            placeholder="Full name"
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            className="border p-2 rounded md:col-span-3"
          />

          <select
            value={form.staff_type}
            onChange={(e) => setForm({ ...form, staff_type: e.target.value })}
            className="border p-2 rounded"
          >
            <option value="">Staff Type</option>
            <option value="Teaching">Teaching</option>
            <option value="Non-Teaching">Non-Teaching</option>
          </select>

          <select
            value={form.department_id}
            onChange={(e) => setForm({ ...form, department_id: e.target.value })}
            className="border p-2 rounded"
          >
            <option value="">Select Department</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>

          <input
            placeholder="Role / Assignment"
            value={form.role_assignment}
            onChange={(e) => setForm({ ...form, role_assignment: e.target.value })}
            className="border p-2 rounded"
          />

          <div className="flex flex-col">
            <label className="text-xs text-slate-600">Date Joined</label>
            <input
              type="date"
              value={form.date_joined}
              onChange={(e) => setForm({ ...form, date_joined: e.target.value })}
              className="border p-2 rounded"
            />
          </div>

          <button onClick={save} className="bg-black text-white px-4 py-2 rounded">
            Add Staff
          </button>
        </div>
      )}

      {/* TABLE */}
      <table className="w-full border bg-white">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Department</th>
            <th>Role</th>
            <th>Date Joined</th>
            <th>Active</th>
            {!readOnly && <th>Actions</th>}
          </tr>
        </thead>

        <tbody>
          {loading ? (
            <tr>
              <td colSpan={7} className="p-4">Loading...</td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="p-4">No staff found</td>
            </tr>
          ) : (
            rows.map((r) =>
              editingId === r.id && editDraft ? (
                <tr key={r.id} className="bg-yellow-50">
                  <td colSpan={7} className="p-3">
                    <div className="grid md:grid-cols-3 gap-2">

                      <input
                        value={editDraft.full_name}
                        onChange={(e) =>
                          setEditDraft(d => d ? { ...d, full_name: e.target.value } : d)
                        }
                        className="border p-2 rounded md:col-span-3"
                      />

                      <select
                        value={editDraft.staff_type}
                        onChange={(e) =>
                          setEditDraft(d => d ? { ...d, staff_type: e.target.value } : d)
                        }
                        className="border p-2 rounded"
                      >
                        <option value="">Staff Type</option>
                        <option value="Teaching">Teaching</option>
                        <option value="Non-Teaching">Non-Teaching</option>
                      </select>

                      <select
                        value={editDraft.department_id}
                        onChange={(e) =>
                          setEditDraft(d => d ? { ...d, department_id: e.target.value } : d)
                        }
                        className="border p-2 rounded"
                      >
                        <option value="">Select Department</option>
                        {departments.map(d => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>

                      <input
                        value={editDraft.role_assignment}
                        onChange={(e) =>
                          setEditDraft(d => d ? { ...d, role_assignment: e.target.value } : d)
                        }
                        className="border p-2 rounded"
                      />

                      <div>
                        <label className="text-xs">Date Joined</label>
                        <input
                          type="date"
                          value={editDraft.date_joined}
                          onChange={(e) =>
                            setEditDraft(d => d ? { ...d, date_joined: e.target.value } : d)
                          }
                          className="border p-2 rounded w-full"
                        />
                      </div>

                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={editDraft.is_active}
                          onChange={(e) =>
                            setEditDraft(d => d ? { ...d, is_active: e.target.checked } : d)
                          }
                        />
                        Active
                      </label>

                      <div className="md:col-span-3 flex justify-end gap-2">
                        <button onClick={saveEdit} className="bg-black text-white px-3 py-1 rounded">
                          Save
                        </button>
                        <button onClick={cancelEdit} className="border px-3 py-1 rounded">
                          Cancel
                        </button>
                      </div>

                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{r.full_name}</td>
                  <td>{r.staff_type}</td>
                  <td>{r.department?.name ?? "—"}</td>
                  <td>{r.role_assignment}</td>
                  <td>{r.date_joined ?? "—"}</td>
                  <td>{r.is_active ? "Yes" : "No"}</td>

                  {!readOnly && (
                    <td>
                      <button
                        onClick={() => startEdit(r)}
                        className="text-indigo-600"
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
  );
}