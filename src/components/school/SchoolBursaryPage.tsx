import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";
import { SearchableCombobox } from "@/components/common/SearchableCombobox";
import { fetchAllPages } from "@/lib/supabasePagination";

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
const TERMS = ["Term 1", "Term 2", "Term 3"];

export function SchoolBursaryPage({ readOnly }: Props) {
  const { user } = useAuth();
  const [rows, setRows] = useState<BursaryRow[]>([]);
  const [students, setStudents] = useState<StudentOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [terms, setTerms] = useState(TERMS.map((term_name) => ({ term_name, amount: "", notes: "" })));
  const [form, setForm] = useState({
    student_id: "",
    academic_year: new Date().getFullYear().toString(),
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
      fetchAllPages<BursaryRow>((from, to) => supabase
        .from("school_bursaries")
        .select("id,student_id,academic_year,term_name,amount,notes")
        .eq("organization_id", orgId)
        .order("academic_year", { ascending: false })
        .order("id").range(from, to)).then(
          (data) => ({ data, error: null }),
          (error) => ({ data: null, error: { message: error instanceof Error ? error.message : "Failed to load bursaries." } })
        ),
      fetchAllPages<StudentOpt>((from, to) => supabase
        .from("students")
        .select("id,admission_number,first_name,last_name")
        .eq("organization_id", orgId)
        .order("admission_number", { ascending: true })
        .order("id")
        .range(from, to)).then(
          (data) => ({ data, error: null }),
          (error) => ({ data: null, error: { message: error instanceof Error ? error.message : "Failed to load students." } })
        ),
    ]);
    setErr(bRes.error?.message || sRes.error?.message || null);
    setRows((bRes.data as BursaryRow[]) || []);
    setStudents((sRes.data as StudentOpt[]) || []);
    setLoading(false);
  }, [user?.organization_id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setTerms(TERMS.map((term_name) => {
      const existing = rows.find((row) => row.student_id === form.student_id
        && row.academic_year === form.academic_year.trim() && row.term_name === term_name);
      return { term_name, amount: existing ? String(existing.amount) : "", notes: existing?.notes || "" };
    }));
    setSaved(false);
  }, [form.student_id, form.academic_year, rows]);

  const save = async () => {
    if (readOnly || saving || loading) return;
    const entered = terms.filter((term) => term.amount.trim() !== "");
    if (!user?.organization_id || !form.student_id || !form.academic_year.trim() || entered.length === 0) {
      setErr("Choose a student, enter an academic year and at least one term amount.");
      return;
    }
    if (entered.some((term) => !Number.isFinite(Number(term.amount)) || Number(term.amount) < 0)) {
      setErr("Each bursary amount must be a valid number of 0 or more.");
      return;
    }
    setErr(null);
    setSaved(false);
    setSaving(true);
    try {
    const { error } = await supabase.from("school_bursaries").upsert(
      entered.map((term) => ({
        organization_id: user.organization_id,
        student_id: form.student_id,
        academic_year: form.academic_year.trim(),
        term_name: term.term_name,
        amount: Number(term.amount),
        notes: term.notes.trim() || null,
      })),
      { onConflict: "organization_id,student_id,academic_year,term_name" }
    );
    if (error) {
      setErr(error.message);
      return;
    }
    await load();
    setSaved(true);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Failed to save bursaries.");
    } finally {
      setSaving(false);
    }
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
      {saved && <p role="status" className="text-emerald-700 text-sm">Bursaries saved.</p>}

      {!readOnly && (
        <fieldset disabled={saving || loading} className="rounded-xl border border-slate-200 bg-white p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <SearchableCombobox
            value={form.student_id}
            onChange={(id) => setForm((f) => ({ ...f, student_id: id }))}
            options={students.map((s) => ({ id: s.id, label: `${s.first_name} ${s.last_name} — ${s.admission_number}` }))}
            placeholder="Type student name or admission number…"
            inputAriaLabel="Search student for bursary"
            clearable
            disabled={saving || loading}
          />
          <input
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="Academic year"
            value={form.academic_year}
            onChange={(e) => setForm((f) => ({ ...f, academic_year: e.target.value }))}
          />
          <div className="md:col-span-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="p-2 text-left">Term</th><th className="p-2 text-left">Bursary amount</th><th className="p-2 text-left">Notes (optional)</th></tr></thead>
              <tbody>{terms.map((term, index) => (
                <tr key={term.term_name} className="border-t">
                  <th scope="row" className="p-2 text-left whitespace-nowrap">{term.term_name}</th>
                  <td className="p-2"><input type="number" min="0" step="any" aria-label={`${term.term_name} bursary amount`} placeholder="Amount" value={term.amount}
                    onChange={(event) => { setSaved(false); setTerms((current) => current.map((item, i) => i === index ? { ...item, amount: event.target.value } : item)); }}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2" /></td>
                  <td className="p-2"><input aria-label={`${term.term_name} notes`} value={term.notes}
                    onChange={(event) => { setSaved(false); setTerms((current) => current.map((item, i) => i === index ? { ...item, notes: event.target.value } : item)); }}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2" /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p className="md:col-span-2 text-xs text-slate-600">Existing amounts load for the selected student and year. Leave an amount blank to keep that term unchanged; enter 0 to remove its reduction.</p>
          <button type="button" onClick={save} className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-800 w-fit">
            {saving ? "Saving…" : "Save term bursaries"}
          </button>
        </fieldset>
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
