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
    const { error } = await supabase.from("students").insert({
      ...form,
      class_id: form.class_id || null,
      stream_id: form.stream_id || null,
      date_of_birth: form.date_of_birth || null,
    });

    if (!error) {
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
      load();
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Student Bio Data</h1>

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

        <button onClick={save} className="bg-black text-white px-4 py-2 rounded">
          Save Student
        </button>
      </div>
    </div>
  );
}