import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { canUseSchoolApi, createSchoolRow, listSchoolRows } from "@/lib/schoolApiData";
import { nextSchoolAdmissionNumber } from "@/lib/schoolAdmissionNumber";

type CatRow = { id: string; name: string };
type ParentRow = { id: string; full_name: string; email?: string | null; phone?: string | null; phone_alt?: string | null };

type StudentRow = {
  id: string;
  admission_number: string;
  first_name: string;
  last_name: string;
  other_names: string | null;
  school_pay_number: string | null;
  learner_id: string | null;
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
  const [showNewParent, setShowNewParent] = useState(false);
  const [savingParent, setSavingParent] = useState(false);
  const [parentForm, setParentForm] = useState({ full_name: "", phone: "", email: "" });
  const nextAdmissionNumber = nextSchoolAdmissionNumber(rows.map((row) => row.admission_number));

  const [form, setForm] = useState({
    admission_number: "",
    first_name: "",
    last_name: "",
    other_names: "",
    school_pay_number: "",
    learner_id: "",
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

    if (canUseSchoolApi()) {
      try {
        const [s, p, c, st] = await Promise.all([
          listSchoolRows<StudentRow>("students", orgId),
          listSchoolRows<ParentRow>("parents", orgId),
          listSchoolRows<CatRow>("classes", orgId),
          listSchoolRows<CatRow>("streams", orgId),
        ]);
        setRows(s);
        setParents(p);
        setClasses(c);
        setStreams(st);
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : "Failed to load school records.");
      }
      return;
    }

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

  const addParent = async () => {
    const orgId = user?.organization_id;
    if (!orgId || !parentForm.full_name.trim()) {
      setErrorMsg("Enter the parent or guardian's full name.");
      return;
    }
    setSavingParent(true); setErrorMsg(null);
    try {
      const payload = { full_name: parentForm.full_name.trim(), phone: parentForm.phone.trim() || null, email: parentForm.email.trim() || null, phone_alt: null };
      let created: ParentRow;
      if (canUseSchoolApi()) {
        created = await createSchoolRow<ParentRow>("parents", orgId, payload);
      } else {
        const { data, error } = await supabase.from("parents").insert({ organization_id: orgId, ...payload }).select("id,full_name,email,phone,phone_alt").single();
        if (error || !data) throw error || new Error("Failed to create parent or guardian.");
        created = data as ParentRow;
      }
      setParents((current) => [...current, created].sort((a, b) => a.full_name.localeCompare(b.full_name)));
      setForm((current) => ({ ...current, parent_id: created.id }));
      setParentForm({ full_name: "", phone: "", email: "" });
      setShowNewParent(false);
      setSuccessMsg(`${created.full_name} was added and selected as the parent/guardian.`);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "Failed to create parent or guardian.");
    } finally {
      setSavingParent(false);
    }
  };

  // SAVE
  const save = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);

    const orgId = user?.organization_id;
    if (!orgId) {
      setErrorMsg("No organization is attached to your account.");
      return;
    }
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setErrorMsg("First name and last name are required.");
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
      const payload = {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        other_names: form.other_names.trim() || null,
        school_pay_number: form.school_pay_number.trim() || null,
        learner_id: form.learner_id.trim() || null,
        class_id: form.class_id || null,
        stream_id: form.stream_id || null,
        parent_id: form.parent_id || null,
        class_name: selectedClass.name,
        stream: selectedStream?.name ?? null,
        date_of_birth: form.date_of_birth || null,
        is_boarding: form.is_boarding,
        has_health_issue: form.has_health_issue,
        photo_url: form.photo_url || null,
      };

      if (canUseSchoolApi()) {
        await createSchoolRow<StudentRow>("students", orgId, payload);
        setForm({
          admission_number: "",
          first_name: "",
          last_name: "",
          other_names: "",
          school_pay_number: "",
          learner_id: "",
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
        return;
      }

      // The hosted schema stores parent relationships in student_parents,
      // not as a parent_id column on students.
      const { parent_id: parentId, ...studentPayload } = payload;

      const { data: student, error: studentErr } = await supabase
        .from("students")
        .insert({ organization_id: orgId, ...studentPayload })
        .select("id")
        .single();

      if (studentErr || !student?.id) {
        throw studentErr || new Error("Failed to create student.");
      }

      if (parentId) {
        const { error: parentLinkErr } = await supabase.from("student_parents").insert({
          student_id: student.id,
          parent_id: parentId,
          is_primary: true,
        });
        if (parentLinkErr) throw parentLinkErr;
      }

      setForm({
        admission_number: "",
        first_name: "",
        last_name: "",
        other_names: "",
        school_pay_number: "",
        learner_id: "",
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

        <div>
          <label className="text-xs font-medium text-slate-600">Admission number</label>
          <input
            value={nextAdmissionNumber}
            readOnly
            aria-describedby="admission-number-help"
            className="w-full cursor-not-allowed rounded border bg-slate-50 p-2 font-mono text-slate-700"
          />
          <p id="admission-number-help" className="mt-1 text-xs text-slate-500">Assigned automatically when the student is saved.</p>
        </div>

        <input placeholder="First Name"
          value={form.first_name}
          onChange={e => setForm({ ...form, first_name: e.target.value })}
          className="border p-2 rounded" />

        <input placeholder="Last Name"
          value={form.last_name}
          onChange={e => setForm({ ...form, last_name: e.target.value })}
          className="border p-2 rounded" />

        <input placeholder="Other names"
          value={form.other_names}
          onChange={e => setForm({ ...form, other_names: e.target.value })}
          className="border p-2 rounded" />

        <input placeholder="SchoolPay number"
          value={form.school_pay_number}
          onChange={e => setForm({ ...form, school_pay_number: e.target.value })}
          className="border p-2 rounded" />

        <input placeholder="Learner ID"
          value={form.learner_id}
          onChange={e => setForm({ ...form, learner_id: e.target.value })}
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
        <div className="flex gap-2">
          <select value={form.parent_id}
            onChange={e => setForm({ ...form, parent_id: e.target.value })}
            className="min-w-0 flex-1 border p-2 rounded">
            <option value="">Parent / Guardian</option>
            {parents.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
          <button type="button" onClick={() => setShowNewParent((open) => !open)} className="shrink-0 rounded border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100">+ Add parent</button>
        </div>

        {showNewParent && <div className="md:col-span-3 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
          <p className="mb-2 text-sm font-semibold text-slate-800">New parent / guardian</p>
          <div className="grid gap-2 md:grid-cols-3">
            <input value={parentForm.full_name} onChange={(e) => setParentForm((p) => ({ ...p, full_name: e.target.value }))} placeholder="Full name *" className="rounded border border-slate-300 bg-white px-3 py-2 text-sm" />
            <input value={parentForm.phone} onChange={(e) => setParentForm((p) => ({ ...p, phone: e.target.value }))} placeholder="Phone number" className="rounded border border-slate-300 bg-white px-3 py-2 text-sm" />
            <input type="email" value={parentForm.email} onChange={(e) => setParentForm((p) => ({ ...p, email: e.target.value }))} placeholder="Email address" className="rounded border border-slate-300 bg-white px-3 py-2 text-sm" />
          </div>
          <div className="mt-3 flex gap-2"><button type="button" disabled={savingParent} onClick={() => void addParent()} className="rounded bg-indigo-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{savingParent ? "Adding…" : "Add and select parent"}</button><button type="button" onClick={() => setShowNewParent(false)} className="rounded border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700">Cancel</button></div>
        </div>}

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
        {!canUseSchoolApi() && (
          <input type="file" onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;

            const path = `students/${Date.now()}-${file.name}`;
            await supabase.storage.from("school").upload(path, file);

            const { data } = supabase.storage.from("school").getPublicUrl(path);
            setForm({ ...form, photo_url: data.publicUrl });
          }}
          />
        )}

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
