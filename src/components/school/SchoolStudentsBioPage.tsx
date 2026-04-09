import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

type CatRow = { id: string; name: string };
type ParentRow = { id: string; full_name: string };

type StudentRow = {
  id: string;
  admission_number: string;
  first_name: string;
  last_name: string;
  class_name: string;
  stream: string | null;
  class_id: string | null;
  stream_id: string | null;
  parent_id: string | null;

  date_of_birth: string | null;
  is_boarding: boolean;
  has_health_issue: boolean;
  photo_url: string | null;
};

export function SchoolStudentsBioPage() {
  const { user } = useAuth();

  const [rows, setRows] = useState<StudentRow[]>([]);
  const [parents, setParents] = useState<ParentRow[]>([]);
  const [classes, setClasses] = useState<CatRow[]>([]);
  const [streams, setStreams] = useState<CatRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [form, setForm] = useState({
    admission_number: "",
    first_name: "",
    last_name: "",
    class_id: "",
    stream_id: "",
    parent_id: "",
    date_of_birth: "",
    is_boarding: false,
    has_health_issue: false,
    photo_url: "",
  });

  // LOAD DATA
  const load = useCallback(async () => {
    const orgId = user?.organization_id;
    if (!orgId) return;

    const [s, p, c, st] = await Promise.all([
      supabase.from("students").select("*").eq("organization_id", orgId),
      supabase.from("parents").select("*").eq("organization_id", orgId),
      supabase.from("classes").select("*").eq("organization_id", orgId),
      supabase.from("streams").select("*").eq("organization_id", orgId),
    ]);

    setRows(s.data || []);
    setParents(p.data || []);
    setClasses(c.data || []);
    setStreams(st.data || []);
  }, [user?.organization_id]);

  useEffect(() => {
    load();
  }, [load]);

  // SAVE
  const save = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);

    const orgId = user?.organization_id;
    if (!orgId) {
      setErrorMsg("No organization is attached to your account.");
      return;
    }
    if (!form.admission_number.trim() || !form.first_name.trim() || !form.last_name.trim()) {
      setErrorMsg("Admission number, first name, and last name are required.");
      return;
    }
    if (!form.class_id) {
      setErrorMsg("Please select a class.");
      return;
    }

    const selectedClass = classes.find((c) => c.id === form.class_id);
    const selectedStream = streams.find((s) => s.id === form.stream_id);
    if (!selectedClass) {
      setErrorMsg("Selected class was not found.");
      return;
    }

    setSaving(true);
    try {
      const { data: student, error: studentErr } = await supabase
        .from("students")
        .insert({
          organization_id: orgId,
          admission_number: form.admission_number.trim(),
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          class_id: form.class_id || null,
          stream_id: form.stream_id || null,
          class_name: selectedClass.name,
          stream: selectedStream?.name ?? null,
          date_of_birth: form.date_of_birth || null,
          is_boarding: form.is_boarding,
          has_health_issue: form.has_health_issue,
          photo_url: form.photo_url || null,
        })
        .select("id")
        .single();

      if (studentErr || !student?.id) {
        throw studentErr || new Error("Failed to create student.");
      }

      if (form.parent_id) {
        const { error: parentLinkErr } = await supabase.from("student_parents").insert({
          student_id: student.id,
          parent_id: form.parent_id,
          is_primary: true,
        });
        if (parentLinkErr) throw parentLinkErr;
      }

      setForm({
        admission_number: "",
        first_name: "",
        last_name: "",
        class_id: "",
        stream_id: "",
        parent_id: "",
        date_of_birth: "",
        is_boarding: false,
        has_health_issue: false,
        photo_url: "",
      });
      setSuccessMsg("Student saved successfully.");
      await load();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to save student.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Student Bio Data</h1>
      {errorMsg && <p className="text-sm text-red-600">{errorMsg}</p>}
      {successMsg && <p className="text-sm text-emerald-700">{successMsg}</p>}

      {/* FORM */}
      <div className="grid md:grid-cols-3 gap-3 border p-4 rounded-xl bg-white">

        <input placeholder="Admission Number"
          value={form.admission_number}
          onChange={e => setForm({ ...form, admission_number: e.target.value })}
          className="border p-2 rounded" />

        <input placeholder="First Name"
          value={form.first_name}
          onChange={e => setForm({ ...form, first_name: e.target.value })}
          className="border p-2 rounded" />

        <input placeholder="Last Name"
          value={form.last_name}
          onChange={e => setForm({ ...form, last_name: e.target.value })}
          className="border p-2 rounded" />

        {/* CLASS */}
        <select value={form.class_id}
          onChange={e => setForm({ ...form, class_id: e.target.value })}
          className="border p-2 rounded">
          <option value="">Select Class</option>
          {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        {/* STREAM */}
        <select value={form.stream_id}
          onChange={e => setForm({ ...form, stream_id: e.target.value })}
          className="border p-2 rounded">
          <option value="">Stream</option>
          {streams.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        {/* PARENT */}
        <select value={form.parent_id}
          onChange={e => setForm({ ...form, parent_id: e.target.value })}
          className="border p-2 rounded">
          <option value="">Parent / Guardian</option>
          {parents.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>

        {/* DOB */}
        <div>
          <label className="text-xs">Date of Birth</label>
          <input type="date"
            value={form.date_of_birth}
            onChange={e => setForm({ ...form, date_of_birth: e.target.value })}
            className="border p-2 rounded w-full" />
        </div>

        {/* BOARDING */}
        <select
          value={form.is_boarding ? "boarding" : "day"}
          onChange={e => setForm({ ...form, is_boarding: e.target.value === "boarding" })}
          className="border p-2 rounded"
        >
          <option value="day">Day</option>
          <option value="boarding">Boarding</option>
        </select>

        {/* HEALTH */}
        <label className="flex items-center gap-2">
          <input type="checkbox"
            checked={form.has_health_issue}
            onChange={e => setForm({ ...form, has_health_issue: e.target.checked })}
          />
          Health Issue
        </label>

        {/* PHOTO */}
        <input type="file"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;

            const path = `students/${Date.now()}-${file.name}`;
            await supabase.storage.from("school").upload(path, file);

            const { data } = supabase.storage.from("school").getPublicUrl(path);
            setForm({ ...form, photo_url: data.publicUrl });
          }}
        />

        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="bg-black text-white px-4 py-2 rounded disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {saving ? "Saving..." : "Save Student"}
        </button>
      </div>
    </div>
  );
}