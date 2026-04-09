import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";

type StudentOpt = { id: string; admission_number: string; first_name: string; last_name: string };
type BursaryRow = {
  id: string;
  student_id: string;
  academic_year: string;
  term_name: string;
  amount: number;
  notes: string | null;
};

type Props = { readOnly?: boolean };

export function SchoolBursaryPage({ readOnly }: Props) {
  const { user } = useAuth();
  const [rows, setRows] = useState<BursaryRow[]>([]);
  const [students, setStudents] = useState<StudentOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    student_id: "",
    academic_year: new Date().getFullYear().toString(),
    term_name: "Term 1",
    amount: "",
    notes: "",
  });

  const studentLabelById = useMemo(() => {
    const m = new Map(students.map((s) => [s.id, `${s.admission_number} — ${s.first_name} ${s.last_name}`]));
    return (id: string) => m.get(id) ?? id;
  }, [students]);

  const load = useCallback(async () => {
    setLoading(true);
    const orgId = user?.organization_id;
    if (!orgId) {
      setRows([]);
      setStudents([]);
      setLoading(false);
      return;
    }
    const [bRes, sRes] = await Promise.all([
      supabase
        .from("school_bursaries")
        .select("id,student_id,academic_year,term_name,amount,notes")
        .eq("organization_id", orgId)
        .order("academic_year", { ascending: false })
        .order("term_name", { ascending: false }),
      supabase
        .from("students")
        .select("id,admission_number,first_name,last_name")
        .eq("organization_id", orgId)
        .order("admission_number", { ascending: true }),
    ]);
    setErr(bRes.error?.message || sRes.error?.message || null);
    setRows((bRes.data as BursaryRow[]) || []);
    setStudents((sRes.data as StudentOpt[]) || []);
    setLoading(false);
  }, [user?.organization_id]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (readOnly) return;
    if (!form.student_id || !form.academic_year.trim() || !form.term_name.trim() || !form.amount) {
      setErr("Student, year, term and amount are required.");
      return;
    }
    const amount = Number(form.amount);
    if (!(amount >= 0)) {
      setErr("Bursary amount must be 0 or more.");
      return;
    }
    setErr(null);
    const { error } = await supabase.from("school_bursaries").upsert(
      {
        student_id: form.student_id,
        academic_year: form.academic_year.trim(),
        term_name: form.term_name.trim(),
        amount,
        notes: form.notes.trim() || null,
      },
      { onConflict: "organization_id,student_id,academic_year,term_name" }
    );
    if (error) {
      setErr(error.message);
      return;
    }
    setForm((f) => ({ ...f, student_id: "", amount: "", notes: "" }));
    void load();
  };

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Bursary</h1>
        <PageNotes ariaLabel="Bursary">
          <p>Set how much school fees are reduced per student and term. Invoices read bursary values automatically.</p>
        </PageNotes>
      </div>
      {err && <p className="text-red-600 text-sm">{err}</p>}

      {!readOnly && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <select
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            value={form.student_id}
            onChange={(e) => setForm((f) => ({ ...f, student_id: e.target.value }))}
          >
            <option value="">Student</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.admission_number} — {s.first_name} {s.last_name}
              </option>
            ))}
          </select>
          <input
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="Academic year"
            value={form.academic_year}
            onChange={(e) => setForm((f) => ({ ...f, academic_year: e.target.value }))}
          />
          <input
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="Term"
            value={form.term_name}
            onChange={(e) => setForm((f) => ({ ...f, term_name: e.target.value }))}
          />
          <input
            type="number"
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="Bursary amount"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          />
          <input
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm md:col-span-2"
            placeholder="Notes (optional)"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
          <button type="button" onClick={save} className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-800 w-fit">
            Save bursary
          </button>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left p-3 font-semibold text-slate-700">Student</th>
              <th className="text-left p-3 font-semibold text-slate-700">Year / term</th>
              <th className="text-right p-3 font-semibold text-slate-700">Reduction</th>
              <th className="text-left p-3 font-semibold text-slate-700">Notes</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="p-6 text-slate-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={4} className="p-6 text-slate-500">No bursary records yet.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="p-3 text-slate-700">{studentLabelById(r.student_id)}</td>
                  <td className="p-3 text-slate-700">{r.academic_year} · {r.term_name}</td>
                  <td className="p-3 text-right text-slate-900">{Number(r.amount).toLocaleString()}</td>
                  <td className="p-3 text-slate-600">{r.notes ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
