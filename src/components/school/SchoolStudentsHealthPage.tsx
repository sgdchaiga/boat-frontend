import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, ShieldAlert } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

type Student = { id: string; admission_number: string; first_name: string; last_name: string; class_name: string; stream: string | null; has_health_issue: boolean };
type HealthRecord = { id: string; student_id: string; condition_name: string; allergies: string | null; medication: string | null; emergency_action: string | null; notes: string | null; updated_at: string };

const emptyForm = { student_id: "", condition_name: "", allergies: "", medication: "", emergency_action: "", notes: "" };

export function StudentsHealthPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const [students, setStudents] = useState<Student[]>([]);
  const [records, setRecords] = useState<HealthRecord[]>([]);
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    const [studentResult, recordResult] = await Promise.all([
      supabase.from("students").select("id,admission_number,first_name,last_name,class_name,stream,has_health_issue").eq("organization_id", orgId).order("first_name"),
      supabase.from("school_student_health_records").select("id,student_id,condition_name,allergies,medication,emergency_action,notes,updated_at").eq("organization_id", orgId).order("updated_at", { ascending: false }),
    ]);
    if (studentResult.error) setError(studentResult.error.message); else setStudents((studentResult.data || []) as Student[]);
    if (recordResult.error) setError(recordResult.error.message); else setRecords((recordResult.data || []) as HealthRecord[]);
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  const classes = useMemo(() => [...new Set(students.map((student) => student.class_name).filter(Boolean))].sort(), [students]);
  const filteredStudents = useMemo(() => {
    const query = search.trim().toLowerCase();
    return students.filter((student) => (!classFilter || student.class_name === classFilter) && (!query || `${student.admission_number} ${student.first_name} ${student.last_name} ${student.class_name} ${student.stream || ""}`.toLowerCase().includes(query)));
  }, [students, search, classFilter]);
  const selectedStudent = students.find((student) => student.id === form.student_id);

  const save = async () => {
    if (!orgId || !form.student_id || !form.condition_name.trim()) return void setError("Select a student and enter the health condition or alert.");
    setSaving(true); setError(null); setMessage(null);
    const { error: saveError } = await supabase.from("school_student_health_records").insert({
      organization_id: orgId, student_id: form.student_id, condition_name: form.condition_name.trim(), allergies: form.allergies.trim() || null,
      medication: form.medication.trim() || null, emergency_action: form.emergency_action.trim() || null, notes: form.notes.trim() || null, recorded_by: user?.id || null,
    });
    if (saveError) setError(saveError.message); else {
      await supabase.from("students").update({ has_health_issue: true }).eq("id", form.student_id).eq("organization_id", orgId);
      setMessage(`Health information saved for ${selectedStudent?.first_name || "student"}.`); setForm(emptyForm); await load();
    }
    setSaving(false);
  };

  return <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
    <div><div className="flex items-center gap-2"><ShieldAlert className="h-6 w-6 text-rose-600" /><h1 className="text-2xl font-bold text-slate-900">Student health information</h1></div><p className="mt-1 text-sm text-slate-600">Find students by name, admission number or class, then record health alerts and emergency guidance.</p></div>
    {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}{message && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="font-semibold text-slate-900">Find a student</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_240px]">
        <label className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search student or admission number" className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm" /></label>
        <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">All classes</option>{classes.map((name) => <option key={name}>{name}</option>)}</select>
      </div>
      <div className="mt-3 max-h-52 overflow-auto rounded-lg border border-slate-200">
        {filteredStudents.map((student) => <button key={student.id} type="button" onClick={() => setForm((current) => ({ ...current, student_id: student.id }))} className={`flex w-full items-center justify-between border-b border-slate-100 px-4 py-3 text-left text-sm last:border-0 ${form.student_id === student.id ? "bg-indigo-50 ring-1 ring-inset ring-indigo-300" : "hover:bg-slate-50"}`}><span><strong>{student.first_name} {student.last_name}</strong><span className="ml-2 text-slate-500">{student.admission_number}</span></span><span className="text-slate-600">{student.class_name}{student.stream ? ` · ${student.stream}` : ""}</span></button>)}
        {filteredStudents.length === 0 && <p className="p-5 text-center text-sm text-slate-500">No students match the search.</p>}
      </div>
    </section>
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="font-semibold text-slate-900">Add health information {selectedStudent && <span className="text-indigo-700">· {selectedStudent.first_name} {selectedStudent.last_name}</span>}</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <input value={form.condition_name} onChange={(e) => setForm((p) => ({ ...p, condition_name: e.target.value }))} placeholder="Condition or health alert *" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <input value={form.allergies} onChange={(e) => setForm((p) => ({ ...p, allergies: e.target.value }))} placeholder="Allergies" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <input value={form.medication} onChange={(e) => setForm((p) => ({ ...p, medication: e.target.value }))} placeholder="Medication" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <input value={form.emergency_action} onChange={(e) => setForm((p) => ({ ...p, emergency_action: e.target.value }))} placeholder="Emergency action / instructions" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <textarea value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Additional health notes" className="min-h-20 rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2" />
      </div><button type="button" disabled={saving || !form.student_id} onClick={() => void save()} className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save health information"}</button>
    </section>
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-200 px-5 py-4"><h2 className="font-semibold text-slate-900">Recorded health alerts</h2></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="p-3 text-left">Student</th><th className="p-3 text-left">Class</th><th className="p-3 text-left">Condition</th><th className="p-3 text-left">Allergies / medication</th><th className="p-3 text-left">Emergency action</th></tr></thead><tbody>{records.map((record) => { const student=students.find((row)=>row.id===record.student_id); return <tr key={record.id} className="border-t"><td className="p-3 font-medium">{student ? `${student.first_name} ${student.last_name}` : "Student"}</td><td className="p-3">{student?.class_name || "—"}</td><td className="p-3">{record.condition_name}</td><td className="p-3 text-slate-600">{[record.allergies,record.medication].filter(Boolean).join(" · ") || "—"}</td><td className="p-3 text-slate-600">{record.emergency_action || "—"}</td></tr>; })}</tbody></table>{records.length===0&&<p className="p-6 text-center text-sm text-slate-500">No health information recorded yet.</p>}</div></section>
  </div>;
}
