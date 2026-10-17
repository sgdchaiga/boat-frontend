import { useCallback, useEffect, useMemo, useState } from "react";
import { BellRing, Download, FileText, Phone, Plus, RefreshCw, Send, ShieldAlert, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { fetchAllPages } from "@/lib/supabasePagination";
import { SchoolFilterBar, type SchoolFilterChip } from "@/components/common/SchoolFilterBar";

type Student = { id: string; first_name: string; other_names?: string | null; last_name: string; admission_number?: string | null; class_name?: string | null; status?: string | null };
type Invoice = { id: string; student_id: string; invoice_number: string; academic_year?: string | null; term_name?: string | null; issue_date?: string | null; due_date?: string | null; total_due: number | string; amount_paid: number | string; status: string };
type Parent = { id: string; full_name?: string | null; phone?: string | null; phone_alt?: string | null; email?: string | null };
type StudentParent = { student_id: string; parent_id: string; is_primary?: boolean | null };
type CreditAction = { id: string; student_id: string; student_invoice_id?: string | null; action_type: string; action_date: string; notes: string; promise_amount?: number | string | null; promise_date?: string | null; created_at: string };
type ActionDraft = { invoice: Invoice; type: string; notes: string; promiseAmount: string; promiseDate: string };

const currency = new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", maximumFractionDigits: 0 });
const isoToday = () => new Date().toISOString().slice(0, 10);
const number = (value: string | number | null | undefined) => Number(value || 0) || 0;
const csvCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;

function localDate(value: string | null | undefined): string { return String(value || "").slice(0, 10); }
function daysPast(dueDate: string | null | undefined, asOf: string): number {
  if (!dueDate) return 0;
  return Math.max(0, Math.floor((new Date(`${asOf}T00:00:00`).getTime() - new Date(`${dueDate}T00:00:00`).getTime()) / 86_400_000));
}
function ageBand(days: number, due: string | null | undefined): string {
  if (!due || days === 0) return "Current";
  if (days <= 30) return "1–30 days";
  if (days <= 60) return "31–60 days";
  if (days <= 90) return "61–90 days";
  return "90+ days";
}

export function SchoolCreditControlPage({ readOnly = false, onNavigate }: { readOnly?: boolean; onNavigate: (page: string, state?: Record<string, unknown>) => void }) {
  const { user } = useAuth();
  const orgId = user?.organization_id || null;
  const [students, setStudents] = useState<Student[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [contacts, setContacts] = useState<Map<string, Parent>>(new Map());
  const [actions, setActions] = useState<CreditAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [className, setClassName] = useState("");
  const [term, setTerm] = useState("");
  const [age, setAge] = useState("overdue");
  const [asOf, setAsOf] = useState(isoToday);
  const [draft, setDraft] = useState<ActionDraft | null>(null);

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const [studentRows, invoiceRows, parentLinks, parentRows, actionRows] = await Promise.all([
        fetchAllPages<Student>((from, to) => supabase.from("students").select("id,first_name,other_names,last_name,admission_number,class_name,status").eq("organization_id", orgId).order("last_name").range(from, to)),
        fetchAllPages<Invoice>((from, to) => supabase.from("student_invoices").select("id,student_id,invoice_number,academic_year,term_name,issue_date,due_date,total_due,amount_paid,status").eq("organization_id", orgId).neq("status", "cancelled").order("due_date", { ascending: true, nullsFirst: false }).range(from, to)),
        fetchAllPages<StudentParent>((from, to) => supabase.from("student_parents").select("student_id,parent_id,is_primary").eq("organization_id", orgId).order("is_primary", { ascending: false }).range(from, to)),
        fetchAllPages<Parent>((from, to) => supabase.from("parents").select("id,full_name,phone,phone_alt,email").eq("organization_id", orgId).range(from, to)),
        fetchAllPages<CreditAction>((from, to) => supabase.from("school_credit_control_actions").select("id,student_id,student_invoice_id,action_type,action_date,notes,promise_amount,promise_date,created_at").eq("organization_id", orgId).order("action_date", { ascending: false }).range(from, to)),
      ]);
      const parentById = new Map(parentRows.map((parent) => [parent.id, parent]));
      const primaryByStudent = new Map<string, Parent>();
      parentLinks.forEach((link) => { if (!primaryByStudent.has(link.student_id) && parentById.has(link.parent_id)) primaryByStudent.set(link.student_id, parentById.get(link.parent_id)!); });
      setStudents(studentRows); setInvoices(invoiceRows); setContacts(primaryByStudent); setActions(actionRows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load student receivables.");
    } finally { setLoading(false); }
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  const studentById = useMemo(() => new Map(students.map((student) => [student.id, student])), [students]);
  const lastActionByInvoice = useMemo(() => {
    const values = new Map<string, CreditAction>();
    actions.forEach((action) => { if (action.student_invoice_id && !values.has(action.student_invoice_id)) values.set(action.student_invoice_id, action); });
    return values;
  }, [actions]);
  const rows = useMemo(() => invoices.map((invoice) => {
    const balance = Math.max(0, number(invoice.total_due) - number(invoice.amount_paid));
    const student = studentById.get(invoice.student_id);
    const dueDate = invoice.due_date || invoice.issue_date || null;
    const overdueDays = daysPast(dueDate, asOf);
    return { invoice, student, balance, dueDate, overdueDays, band: ageBand(overdueDays, dueDate), contact: contacts.get(invoice.student_id), action: lastActionByInvoice.get(invoice.id) };
  }).filter((row) => row.balance > 0.005), [invoices, studentById, asOf, contacts, lastActionByInvoice]);
  const classOptions = useMemo(() => [...new Set(students.map((student) => student.class_name || "").filter(Boolean))].sort(), [students]);
  const termOptions = useMemo(() => [...new Set(rows.map((row) => `${row.invoice.academic_year || ""} ${row.invoice.term_name || ""}`.trim()).filter(Boolean))].sort(), [rows]);
  const filtered = useMemo(() => rows.filter((row) => {
    const studentName = `${row.student?.first_name || ""} ${row.student?.other_names || ""} ${row.student?.last_name || ""} ${row.student?.admission_number || ""} ${row.invoice.invoice_number}`.toLowerCase();
    return (!query || studentName.includes(query.toLowerCase()))
      && (!className || row.student?.class_name === className)
      && (!term || `${row.invoice.academic_year || ""} ${row.invoice.term_name || ""}`.trim() === term)
      && (age === "all" || (age === "overdue" ? row.overdueDays > 0 : row.band === age));
  }), [rows, query, className, term, age]);
  const totals = useMemo(() => ({ outstanding: rows.reduce((sum, row) => sum + row.balance, 0), overdue: rows.filter((row) => row.overdueDays > 0).reduce((sum, row) => sum + row.balance, 0), students: new Set(rows.map((row) => row.invoice.student_id)).size, actionNeeded: rows.filter((row) => row.overdueDays > 0 && !row.action).length }), [rows]);
  const chips: SchoolFilterChip[] = [className && { key: "class", label: className, onRemove: () => setClassName("") }, term && { key: "term", label: term, onRemove: () => setTerm("") }, age !== "overdue" && { key: "age", label: age === "all" ? "All balances" : age, onRemove: () => setAge("overdue") }].filter(Boolean) as SchoolFilterChip[];

  const exportCsv = () => {
    const lines = [["Student", "Admission no.", "Class", "Invoice", "Term", "Due date", "Age", "Outstanding", "Guardian", "Phone", "Last action"], ...filtered.map((row) => [
      `${row.student?.first_name || ""} ${row.student?.last_name || ""}`.trim(), row.student?.admission_number || "", row.student?.class_name || "", row.invoice.invoice_number, `${row.invoice.academic_year || ""} ${row.invoice.term_name || ""}`.trim(), row.dueDate || "", row.band, row.balance, row.contact?.full_name || "", row.contact?.phone || row.contact?.phone_alt || "", row.action ? `${row.action.action_type} · ${row.action.action_date}` : "",
    ])];
    const url = URL.createObjectURL(new Blob(["\ufeff" + lines.map((line) => line.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `student-receivables-${asOf}.csv`; anchor.click(); URL.revokeObjectURL(url);
  };
  const saveAction = async () => {
    if (!draft || !orgId || !draft.notes.trim() || readOnly) return;
    if (draft.type === "promise_to_pay" && (!draft.promiseAmount || !draft.promiseDate)) {
      setError("Enter both the promised amount and promise date before saving a promise to pay.");
      return;
    }
    setSaving(true); setError(null);
    try {
      const { error: insertError } = await supabase.from("school_credit_control_actions").insert({ organization_id: orgId, student_id: draft.invoice.student_id, student_invoice_id: draft.invoice.id, action_type: draft.type, action_date: isoToday(), notes: draft.notes.trim(), promise_amount: draft.promiseAmount ? number(draft.promiseAmount) : null, promise_date: draft.promiseDate || null, created_by: user?.id || null });
      if (insertError) throw insertError;
      setDraft(null); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The credit-control action was not saved."); }
    finally { setSaving(false); }
  };

  return <main className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Billing control</p><h1 className="mt-1 text-3xl font-bold text-slate-900">Student receivables & credit control</h1><p className="mt-1 max-w-3xl text-sm text-slate-600">Prioritize overdue fees, record each follow-up, and keep payment promises visible to the finance team.</p></div><div className="flex gap-2"><button type="button" onClick={() => void load()} className="app-btn-secondary" disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</button><button type="button" onClick={exportCsv} className="app-btn-secondary"><Download className="h-4 w-4" />Export</button></div></header>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric icon={FileText} label="Outstanding fees" value={currency.format(totals.outstanding)} tone="indigo" /><Metric icon={ShieldAlert} label="Overdue" value={currency.format(totals.overdue)} tone="rose" /><Metric icon={Users} label="Students owing" value={String(totals.students)} tone="amber" /><Metric icon={BellRing} label="Overdue with no action" value={String(totals.actionNeeded)} tone="orange" /></section>
    <SchoolFilterBar search={<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search student, admission no. or invoice" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />} period={<label className="flex items-center gap-2 text-sm text-slate-600">As at <input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value || isoToday())} className="min-w-0 rounded-lg border border-slate-300 px-2 py-2 text-sm" /></label>} activeFilters={chips} onClearAll={() => { setClassName(""); setTerm(""); setAge("overdue"); }} resultSummary={`${filtered.length} outstanding invoice${filtered.length === 1 ? "" : "s"} · ${currency.format(filtered.reduce((sum, row) => sum + row.balance, 0))}`}>
      <div className="grid gap-3 md:grid-cols-3"><FilterSelect label="Class" value={className} onChange={setClassName} options={classOptions} /><FilterSelect label="Term" value={term} onChange={setTerm} options={termOptions} /><label className="text-xs font-semibold text-slate-600">Age <select value={age} onChange={(event) => setAge(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="overdue">Overdue only</option><option value="all">All outstanding</option><option>Current</option><option>1–30 days</option><option>31–60 days</option><option>61–90 days</option><option>90+ days</option></select></label></div>
    </SchoolFilterBar>
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Student / guardian</th><th className="px-4 py-3">Invoice</th><th className="px-4 py-3">Due / age</th><th className="px-4 py-3 text-right">Outstanding</th><th className="px-4 py-3">Last action</th><th className="px-4 py-3" /></tr></thead><tbody className="divide-y divide-slate-100">{loading ? <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">Loading receivables…</td></tr> : filtered.length === 0 ? <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">No outstanding invoices match these filters.</td></tr> : filtered.map((row) => <tr key={row.invoice.id} className="align-top hover:bg-slate-50"><td className="px-4 py-3"><strong className="block text-slate-900">{`${row.student?.first_name || ""} ${row.student?.other_names || ""} ${row.student?.last_name || ""}`.trim() || "Unknown student"}</strong><span className="block text-xs text-slate-500">{[row.student?.admission_number, row.student?.class_name].filter(Boolean).join(" · ") || "—"}</span>{row.contact && <span className="mt-1 block text-xs text-slate-600">{row.contact.full_name || "Guardian"} · {row.contact.phone || row.contact.phone_alt || row.contact.email || "No contact"}</span>}</td><td className="px-4 py-3"><strong className="block text-slate-800">{row.invoice.invoice_number}</strong><span className="text-xs text-slate-500">{`${row.invoice.academic_year || ""} ${row.invoice.term_name || ""}`.trim() || "—"}</span></td><td className="px-4 py-3"><span className="block text-slate-700">{row.dueDate || "No due date"}</span><span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${row.overdueDays ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600"}`}>{row.band}{row.overdueDays ? ` overdue` : ""}</span></td><td className="px-4 py-3 text-right font-bold text-slate-900">{currency.format(row.balance)}</td><td className="px-4 py-3 text-xs text-slate-600">{row.action ? <><strong className="block capitalize text-slate-800">{row.action.action_type.replace(/_/g, " ")}</strong>{row.action.action_date}<span className="mt-1 block max-w-56 truncate">{row.action.notes}</span></> : <span className="text-amber-700">No follow-up logged</span>}</td><td className="px-4 py-3"><div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={() => onNavigate("school_invoices")} className="text-xs font-semibold text-indigo-700 hover:text-indigo-900">Invoice</button>{!readOnly && <button type="button" onClick={() => setDraft({ invoice: row.invoice, type: "call", notes: "", promiseAmount: "", promiseDate: "" })} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"><Plus className="h-3.5 w-3.5" />Log action</button>}</div></td></tr>)}</tbody></table></div></section>
    {draft && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"><section role="dialog" aria-modal="true" className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-bold text-slate-900">Log credit-control action</h2><p className="mt-1 text-sm text-slate-500">{draft.invoice.invoice_number} · this note becomes part of the follow-up history.</p></div><button type="button" onClick={() => setDraft(null)} className="text-slate-500 hover:text-slate-800">×</button></div><div className="mt-5 grid gap-4"><label className="text-sm font-medium text-slate-700">Action <select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"><option value="call">Phone call</option><option value="sms">SMS reminder</option><option value="email">Email reminder</option><option value="letter">Demand letter</option><option value="promise_to_pay">Promise to pay</option><option value="note">Internal note</option></select></label><label className="text-sm font-medium text-slate-700">Outcome / note <textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Who was contacted, what was agreed, and the next step." className="mt-1 min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2" /></label><div className="grid grid-cols-2 gap-3"><label className="text-sm font-medium text-slate-700">Promised amount {draft.type === "promise_to_pay" && <span className="text-rose-600">*</span>}<input inputMode="decimal" value={draft.promiseAmount} onChange={(event) => setDraft({ ...draft, promiseAmount: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label><label className="text-sm font-medium text-slate-700">Promise date {draft.type === "promise_to_pay" && <span className="text-rose-600">*</span>}<input type="date" value={draft.promiseDate} onChange={(event) => setDraft({ ...draft, promiseDate: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label></div></div><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setDraft(null)} className="app-btn-secondary">Cancel</button><button type="button" disabled={saving || !draft.notes.trim() || (draft.type === "promise_to_pay" && (!draft.promiseAmount || !draft.promiseDate))} onClick={() => void saveAction()} className="app-btn-primary"><Send className="h-4 w-4" />{saving ? "Saving…" : "Save action"}</button></div></section></div>}
  </main>;
}

function Metric({ icon: Icon, label, value, tone }: { icon: typeof FileText; label: string; value: string; tone: "indigo" | "rose" | "amber" | "orange" }) { const tones = { indigo: "bg-indigo-50 text-indigo-700", rose: "bg-rose-50 text-rose-700", amber: "bg-amber-50 text-amber-700", orange: "bg-orange-50 text-orange-700" }; return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><span className={`inline-flex rounded-lg p-2 ${tones[tone]}`}><Icon className="h-5 w-5" /></span><p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-xl font-bold text-slate-900">{value}</p></div>; }
function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) { return <label className="text-xs font-semibold text-slate-600">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">All {label.toLowerCase()}es</option>{options.map((option) => <option key={option}>{option}</option>)}</select></label>; }
