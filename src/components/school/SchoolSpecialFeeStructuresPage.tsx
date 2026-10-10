import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";
import { syncStudentInvoiceAccounting } from "@/lib/schoolFeeJournal";

type ClassOpt = { id: string; name: string };
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

export function SchoolSpecialFeeStructuresPage({ readOnly }: Props) {
  const { user } = useAuth();
  const [rows, setRows] = useState<SpecialFeeRow[]>([]);
  const [classes, setClasses] = useState<ClassOpt[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
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
    const [feeResult, classResult] = await Promise.all([
      supabase.from("school_special_fee_structures").select("id,fee_type,academic_year,term_name,amount,notes,is_active,target_class_id,charge_date,reference").eq("organization_id", orgId).order("academic_year", { ascending: false }).order("term_name", { ascending: false }),
      supabase.from("classes").select("id,name").eq("organization_id", orgId).eq("is_active", true).order("sort_order"),
    ]);
    setErr(feeResult.error?.message ?? classResult.error?.message ?? null);
    setRows((feeResult.data as SpecialFeeRow[]) || []);
    setClasses((classResult.data as ClassOpt[]) || []);
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
  const edit = (row: SpecialFeeRow) => {
    setEditingId(row.id);
    setForm({ fee_type: row.fee_type, academic_year: row.academic_year, term_name: row.term_name, amount: String(row.amount), notes: row.notes || "", is_active: row.is_active, target_class_id: row.target_class_id || "", charge_date: row.charge_date || "", reference: row.reference || "" });
  };

  const applyToStudents = async (fee: SpecialFeeRow) => {
    const orgId = user?.organization_id;
    if (!orgId || applyingId) return;
    const classLabel = classes.find((row) => row.id === fee.target_class_id)?.name || "all classes";
    if (!window.confirm(`Create separate ${feeTypeLabel(fee.fee_type)} invoices for eligible ${classLabel} students in ${fee.academic_year} · ${fee.term_name}? Existing matching special-fee invoices will be skipped.`)) return;
    setApplyingId(fee.id);
    setErr(null);
    setApplyMessage(null);
    try {
      const [studentResult, invoiceResult] = await Promise.all([
        supabase.from("students").select("id,class_id,status").eq("organization_id", orgId),
        supabase.from("student_invoices").select("student_id,line_items").eq("organization_id", orgId).eq("academic_year", fee.academic_year).eq("term_name", fee.term_name).neq("status", "cancelled"),
      ]);
      if (studentResult.error) throw studentResult.error;
      if (invoiceResult.error) throw invoiceResult.error;
      const eligible = ((studentResult.data || []) as Array<{ id: string; class_id: string | null; status?: string | null }>)
        .filter((student) => !fee.target_class_id || student.class_id === fee.target_class_id)
        .filter((student) => !["inactive", "withdrawn", "graduated", "archived"].includes(String(student.status || "").trim().toLowerCase()));
      if (eligible.length === 0) throw new Error(`No eligible students were found in ${classLabel}. Check that the students are assigned to that class.`);
      const code = `SPECIAL_STRUCTURE_${fee.id}`;
      const alreadyInvoiced = new Set(((invoiceResult.data || []) as Array<{ student_id: string; line_items: Array<{ code?: string }> | null }>).filter((invoice) => (invoice.line_items || []).some((line) => line.code === code)).map((invoice) => invoice.student_id));
      const pending = eligible.filter((student) => !alreadyInvoiced.has(student.id));
      let created = 0;
      for (const student of pending) {
        const amount = Number(fee.amount) || 0;
        const line_items = [{ code, label: `${feeTypeLabel(fee.fee_type)}${fee.reference ? ` — ${fee.reference}` : ""}`, amount, priority: 1, applies_to: "all" as const }];
        const result = await supabase.from("student_invoices").insert({ student_id: student.id, fee_structure_id: null, academic_year: fee.academic_year, term_name: fee.term_name, invoice_number: `SP-${fee.fee_type.toUpperCase()}-${Date.now().toString(36).toUpperCase()}-${student.id.slice(0, 8)}`, subtotal: amount, line_items, discount_amount: 0, bursary_amount: 0, scholarship_amount: 0, total_due: amount, amount_paid: 0, status: amount > 0 ? "sent" : "paid", issue_date: fee.charge_date || null, notes: fee.reference || fee.notes || null }).select("*").single();
        if (result.error) throw result.error;
        const accounting = await syncStudentInvoiceAccounting({ organizationId: orgId, staffUserId: user?.id ?? null, invoice: result.data });
        if (accounting.journalMessage) throw new Error(accounting.journalMessage);
        created += 1;
      }
      setApplyMessage(`Created ${created} separate invoice${created === 1 ? "" : "s"}; skipped ${alreadyInvoiced.size} already charged student${alreadyInvoiced.size === 1 ? "" : "s"}.`);
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
          <p>Define a charge, its target class, charge date, and reference. A selected class receives the fee only when its term invoice is created.</p>
        </PageNotes>
      </div>
      {err && <p className="text-red-600 text-sm">{err}</p>}
      {applyMessage && <p className="text-emerald-700 text-sm" role="status">{applyMessage}</p>}
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
              rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="p-3 text-slate-700">{feeTypeLabel(r.fee_type)}</td>
                  <td className="p-3 text-slate-700">{classes.find((classRow) => classRow.id === r.target_class_id)?.name || "All classes"} · {r.academic_year} · {r.term_name}</td>
                  <td className="p-3 text-slate-600">{r.charge_date || "—"}{r.reference ? ` · ${r.reference}` : ""}</td>
                  <td className="p-3 text-right text-slate-900">{Number(r.amount).toLocaleString()}</td>
                  <td className="p-3 text-slate-600">{r.notes ?? "—"}</td>
                  <td className="p-3 text-slate-600">{r.is_active ? "Active" : "Inactive"}</td>
                  {!readOnly && <td className="p-3 text-right whitespace-nowrap"><div className="flex justify-end gap-2"><button type="button" onClick={() => edit(r)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Edit</button><button type="button" onClick={() => void applyToStudents(r)} disabled={applyingId !== null || !r.is_active} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">{applyingId === r.id ? "Creating…" : "Create invoices"}</button></div></td>}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
