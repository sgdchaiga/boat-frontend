import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";
import { syncStudentInvoiceAccounting } from "@/lib/schoolFeeJournal";
import { canUseSchoolApi, createSchoolRow, listSchoolRows } from "@/lib/schoolApiData";
import { fetchAllPages } from "@/lib/supabasePagination";

type ClassOpt = { id: string; name: string };
type StudentAudience = { id: string; class_id: string | null; class_name?: string | null; status?: string | null };
type SpecialFeeRow = {
  id: string;
  fee_type: "new_student" | "exam" | "uneb";
  academic_year: string;
  term_name: string;
  amount: number;
  notes: string | null;
  is_active: boolean;
  target_class_id: string | null;
  charge_date: string | null;
  reference: string | null;
};

type Props = { readOnly?: boolean };

function isInTargetClass(studentClassName: string | null | undefined, targetClassName: string | undefined) {
  // Keep this fallback identical to Create term charges: a student's saved class
  // name must exactly match the selected class. The class ID remains the primary
  // match; this only supports older student records without a class ID.
  const studentKey = String(studentClassName || "").trim().toLocaleLowerCase();
  const targetKey = String(targetClassName || "").trim().toLocaleLowerCase();
  return Boolean(studentKey && targetKey && studentKey === targetKey);
}

type InvoiceDuplicateCheck = {
  student_id: string;
  line_items?: unknown;
  status?: string | null;
  notes?: string | null;
  invoice_number?: string | null;
  academic_year?: string | null;
  term_name?: string | null;
};

function savedInvoiceLines(value: unknown): Array<{ code?: string }> {
  if (Array.isArray(value)) return value as Array<{ code?: string }>;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as Array<{ code?: string }> : [];
  } catch {
    return [];
  }
}

async function listCurrentOrganizationStudents(organizationId: string): Promise<StudentAudience[]> {
  // Supabase returns at most 1,000 rows per query. Charge audiences must include
  // every learner in the logged-in organization, not merely its first page.
  return fetchAllPages<StudentAudience>((from, to) => supabase
    .from("students")
    .select("id,class_id,class_name,status")
    .eq("organization_id", organizationId)
    .order("id")
    .range(from, to));
}

export function SchoolSpecialFeeStructuresPage({ readOnly }: Props) {
  const { user } = useAuth();
  const [rows, setRows] = useState<SpecialFeeRow[]>([]);
  const [classes, setClasses] = useState<ClassOpt[]>([]);
  const [students, setStudents] = useState<StudentAudience[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [applyProgress, setApplyProgress] = useState({ completed: 0, total: 0 });
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    fee_type: "new_student" as SpecialFeeRow["fee_type"],
    academic_year: new Date().getFullYear().toString(),
    term_name: "Term 1",
    amount: "",
    notes: "",
    is_active: true,
    target_class_id: "",
    charge_date: new Date().toISOString().slice(0, 10),
    reference: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const orgId = user?.organization_id;
    if (!orgId) {
      setRows([]);
      setLoading(false);
      return;
    }
    const [feeResult, classResult, studentResult] = await Promise.all([
      supabase.from("school_special_fee_structures").select("id,fee_type,academic_year,term_name,amount,notes,is_active,target_class_id,charge_date,reference").eq("organization_id", orgId).order("academic_year", { ascending: false }).order("term_name", { ascending: false }),
      supabase.from("classes").select("id,name").eq("organization_id", orgId).eq("is_active", true).order("sort_order"),
      listCurrentOrganizationStudents(orgId),
    ]);
    setErr(feeResult.error?.message ?? classResult.error?.message ?? null);
    setRows((feeResult.data as SpecialFeeRow[]) || []);
    setClasses((classResult.data as ClassOpt[]) || []);
    setStudents(studentResult);
    setLoading(false);
  }, [user?.organization_id]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (readOnly) return;
    if (!form.academic_year.trim() || !form.term_name.trim() || !form.amount) {
      setErr("Year, term and amount are required.");
      return;
    }
    const amount = Number(form.amount);
    if (!(amount >= 0)) {
      setErr("Amount must be 0 or more.");
      return;
    }
    setErr(null);
    const payload = {
      fee_type: form.fee_type,
      academic_year: form.academic_year.trim(),
      term_name: form.term_name.trim(),
      amount,
      notes: form.notes.trim() || null,
      is_active: form.is_active,
      target_class_id: form.target_class_id || null,
      charge_date: form.charge_date || null,
      reference: form.reference.trim() || null,
    };
    const { error } = editingId
      ? await supabase.from("school_special_fee_structures").update(payload).eq("id", editingId).eq("organization_id", user?.organization_id)
      : await supabase.from("school_special_fee_structures").insert(payload);
    if (error) {
      setErr(error.message);
      return;
    }
    setEditingId(null);
    setForm((f) => ({ ...f, amount: "", notes: "", target_class_id: "", charge_date: new Date().toISOString().slice(0, 10), reference: "" }));
    void load();
  };

  const feeTypeLabel = (t: SpecialFeeRow["fee_type"]) =>
    t === "new_student" ? "New students" : t === "exam" ? "Exam fees" : "UNEB fees";
  const canChargeStudent = (student: StudentAudience) => !["inactive", "withdrawn", "graduated", "archived", "left", "suspended"].includes(String(student.status || "").trim().toLowerCase());
  const audienceFor = (fee: SpecialFeeRow) => {
    const className = classes.find((row) => row.id === fee.target_class_id)?.name;
    return students.filter((student) => !fee.target_class_id || student.class_id === fee.target_class_id || isInTargetClass(student.class_name, className));
  };
  const edit = (row: SpecialFeeRow) => {
    setEditingId(row.id);
    setForm({ fee_type: row.fee_type, academic_year: row.academic_year, term_name: row.term_name, amount: String(row.amount), notes: row.notes || "", is_active: row.is_active, target_class_id: row.target_class_id || "", charge_date: row.charge_date || "", reference: row.reference || "" });
  };

  const applyToStudents = async (fee: SpecialFeeRow) => {
    const orgId = user?.organization_id;
    if (!orgId || applyingId) return;
    const classLabel = classes.find((row) => row.id === fee.target_class_id)?.name || "all classes";
    setApplyingId(fee.id);
    setApplyProgress({ completed: 0, total: 0 });
    setErr(null);
    setApplyMessage(null);
    try {
      const useSchoolApi = canUseSchoolApi();
      const [studentData, invoiceData] = await Promise.all([
        listCurrentOrganizationStudents(orgId),
        useSchoolApi
          ? listSchoolRows<InvoiceDuplicateCheck>("invoices", orgId)
          : fetchAllPages<InvoiceDuplicateCheck>((from, to) => supabase
            .from("student_invoices")
            .select("student_id,line_items,status,notes,invoice_number,academic_year,term_name")
            .eq("organization_id", orgId)
            .eq("academic_year", fee.academic_year)
            .eq("term_name", fee.term_name)
            .neq("status", "cancelled")
            .order("id")
            .range(from, to)),
      ]);
      const targetClassName = classes.find((row) => row.id === fee.target_class_id)?.name;
      const eligible = (studentData as Array<{ id: string; class_id: string | null; class_name?: string | null; status?: string | null }>)
        .filter((student) => !fee.target_class_id || student.class_id === fee.target_class_id || isInTargetClass(student.class_name, targetClassName))
        .filter((student) => !["inactive", "withdrawn", "graduated", "archived", "left", "suspended"].includes(String(student.status || "").trim().toLowerCase()));
      if (eligible.length === 0) throw new Error(`No eligible students were found in ${classLabel}. Check that the students are assigned to that class.`);
      const code = `SPECIAL_STRUCTURE_${fee.id}`;
      const invoicePrefix = `SP-${fee.fee_type.toUpperCase()}-${fee.id.slice(0, 8).toUpperCase()}-`;
      const legacyPrefix = `SP-${fee.fee_type.toUpperCase()}-`;
      const legacyNote = String(fee.reference || fee.notes || "").trim();
      const alreadyInvoiced = new Set((invoiceData as InvoiceDuplicateCheck[]).filter((invoice) => {
        if (String(invoice.status || "").toLowerCase() === "cancelled") return false;
        if (invoice.academic_year !== fee.academic_year || invoice.term_name !== fee.term_name) return false;
        if (savedInvoiceLines(invoice.line_items).some((line) => line.code === code)) return true;
        if (String(invoice.invoice_number || "").startsWith(invoicePrefix)) return true;
        // Earlier local-API invoices omitted line_items. Recognize those safely by their
        // special-fee number prefix, academic period, and saved reference/notes.
        return Boolean(legacyNote)
          && String(invoice.invoice_number || "").startsWith(legacyPrefix)
          && invoice.academic_year === fee.academic_year
          && invoice.term_name === fee.term_name
          && String(invoice.notes || "").trim() === legacyNote;
      }).map((invoice) => invoice.student_id));
      const pending = eligible.filter((student) => !alreadyInvoiced.has(student.id));
      const skipped = eligible.length - pending.length;
      setApplyProgress({ completed: 0, total: pending.length });
      if (!window.confirm(`Create ${feeTypeLabel(fee.fee_type)} invoices for ${pending.length} of ${eligible.length} active student${eligible.length === 1 ? "" : "s"} in ${classLabel} for ${fee.academic_year} · ${fee.term_name}? ${skipped} already charged student${skipped === 1 ? "" : "s"} will be skipped.`)) return;
      if (pending.length === 0) {
        setApplyMessage(`No new invoices were created. All ${eligible.length} selected student${eligible.length === 1 ? "" : "s"} already have this special fee for ${fee.academic_year} · ${fee.term_name}.`);
        return;
      }
      let created = 0;
      for (const student of pending) {
        const amount = Number(fee.amount) || 0;
        const line_items = [{ code, label: `${feeTypeLabel(fee.fee_type)}${fee.reference ? ` — ${fee.reference}` : ""}`, amount, priority: 1, applies_to: "all" as const }];
        const payload = { student_id: student.id, fee_structure_id: null, academic_year: fee.academic_year, term_name: fee.term_name, invoice_number: `${invoicePrefix}${student.id.slice(0, 8).toUpperCase()}`, subtotal: amount, line_items, discount_amount: 0, bursary_amount: 0, scholarship_amount: 0, total_due: amount, amount_paid: 0, status: amount > 0 ? "sent" : "paid", issue_date: fee.charge_date || null, notes: fee.reference || fee.notes || null };
        if (useSchoolApi) await createSchoolRow("invoices", orgId, { ...payload, staff_user_id: user?.id ?? null });
        else {
          const result = await supabase.from("student_invoices").insert(payload).select("*").single();
          if (result.error) throw result.error;
          const accounting = await syncStudentInvoiceAccounting({ organizationId: orgId, staffUserId: user?.id ?? null, invoice: result.data });
          if (accounting.journalMessage) throw new Error(accounting.journalMessage);
        }
        created += 1;
        setApplyProgress({ completed: created, total: pending.length });
      }
      setApplyMessage(`Created ${created} separate invoice${created === 1 ? "" : "s"}; skipped ${skipped} already charged selected student${skipped === 1 ? "" : "s"}.`);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Could not create the special-fee invoices.");
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Special fee structures</h1>
        <PageNotes ariaLabel="Special fees">
          <p>Define a charge, its target class, charge date, and reference. Create invoices from the saved fee to issue one separate invoice per eligible student.</p>
        </PageNotes>
      </div>
      {err && <p className="text-red-600 text-sm">{err}</p>}
      {applyMessage && <p className="text-emerald-700 text-sm" role="status">{applyMessage}</p>}
      {applyingId && applyProgress.total > 0 && <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4" role="status" aria-live="polite"><div className="mb-2 flex justify-between text-sm font-medium text-indigo-900"><span>Creating special-fee invoices…</span><span>{applyProgress.completed} of {applyProgress.total}</span></div><div className="h-2 overflow-hidden rounded-full bg-indigo-100"><div className="h-full bg-indigo-600 transition-all" style={{ width: `${Math.round(applyProgress.completed / applyProgress.total * 100)}%` }} /></div></div>}
      {!readOnly && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <select
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            value={form.fee_type}
            onChange={(e) => setForm((f) => ({ ...f, fee_type: e.target.value as SpecialFeeRow["fee_type"] }))}
          >
            <option value="new_student">New students</option>
            <option value="exam">Exam fees</option>
            <option value="uneb">UNEB fees</option>
          </select>
          <select className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={form.target_class_id} onChange={(e) => setForm((f) => ({ ...f, target_class_id: e.target.value }))}>
            <option value="">All classes</option>
            {classes.map((classRow) => <option key={classRow.id} value={classRow.id}>{classRow.name}</option>)}
          </select>
          <input className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={form.academic_year} onChange={(e) => setForm((f) => ({ ...f, academic_year: e.target.value }))} placeholder="Academic year" />
          <input className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={form.term_name} onChange={(e) => setForm((f) => ({ ...f, term_name: e.target.value }))} placeholder="Term" />
          <input type="number" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="Amount" />
          <input type="date" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={form.charge_date} onChange={(e) => setForm((f) => ({ ...f, charge_date: e.target.value }))} aria-label="Charge date" />
          <input className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} placeholder="Reference, e.g. Exam Jan 2026" />
          <input className="border border-slate-300 rounded-lg px-3 py-2 text-sm md:col-span-2" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Notes (optional)" />
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} />
            Active
          </label>
          <button type="button" onClick={save} className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-800 w-fit">
            {editingId ? "Update special fee" : "Save special fee"}
          </button>
        </div>
      )}
      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left p-3 font-semibold text-slate-700">Fee type</th>
              <th className="text-left p-3 font-semibold text-slate-700">Class · year / term</th>
              <th className="text-left p-3 font-semibold text-slate-700">Charge date / reference</th>
              <th className="text-right p-3 font-semibold text-slate-700">Amount</th>
              <th className="text-left p-3 font-semibold text-slate-700">Notes</th>
              <th className="text-left p-3 font-semibold text-slate-700">Status</th>
              {!readOnly && <th className="p-3"><span className="sr-only">Edit</span></th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={readOnly ? 6 : 7} className="p-6 text-slate-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={readOnly ? 6 : 7} className="p-6 text-slate-500">No special fee structures yet.</td></tr>
            ) : (
              rows.map((r) => {
                const audience = audienceFor(r);
                const eligible = audience.filter(canChargeStudent);
                const statuses = audience.reduce<Record<string, number>>((counts, student) => {
                  const status = String(student.status || "Unspecified").trim() || "Unspecified";
                  counts[status] = (counts[status] || 0) + 1;
                  return counts;
                }, {});
                return <tr key={r.id} className="border-b border-slate-100">
                  <td className="p-3 text-slate-700">{feeTypeLabel(r.fee_type)}</td>
                  <td className="p-3 text-slate-700"><div>{classes.find((classRow) => classRow.id === r.target_class_id)?.name || "All classes"} · {r.academic_year} · {r.term_name}</div><div className="mt-1 text-xs text-slate-500">{eligible.length} eligible of {audience.length} assigned · {Object.entries(statuses).map(([status, count]) => `${status}: ${count}`).join(", ")}</div></td>
                  <td className="p-3 text-slate-600">{r.charge_date || "—"}{r.reference ? ` · ${r.reference}` : ""}</td>
                  <td className="p-3 text-right text-slate-900">{Number(r.amount).toLocaleString()}</td>
                  <td className="p-3 text-slate-600">{r.notes ?? "—"}</td>
                  <td className="p-3 text-slate-600">{r.is_active ? "Active" : "Inactive"}</td>
                  {!readOnly && <td className="p-3 text-right whitespace-nowrap"><div className="flex justify-end gap-2"><button type="button" onClick={() => edit(r)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Edit</button><button type="button" onClick={() => void applyToStudents(r)} disabled={applyingId !== null || !r.is_active} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">{applyingId === r.id ? "Creating…" : "Create invoices"}</button></div></td>}
                </tr>;
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
