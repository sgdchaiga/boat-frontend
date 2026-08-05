import { useCallback, useEffect, useMemo, useState } from "react";
import { Briefcase, CalendarClock, RefreshCw, Users } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";
import { ReadOnlyNotice } from "../common/ReadOnlyNotice";

const db = supabase as any;
const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100";
type Client = { id: string; name: string };
type Staff = { id: string; full_name?: string | null; email?: string | null };
type Template = { id: string; name: string; service_type: string; description: string | null };
type TemplateTask = { title: string; description: string | null; sequence_no: number; due_offset_days: number; estimated_hours: number; requires_review: boolean };
type Engagement = { id: string; engagement_number: string | null; title: string; service_type: string; status: string; priority: string; due_date: string | null; contract_value: number; budgeted_hours: number; client_id: string; responsible_manager_id: string | null };

const initialForm = { client_id: "", title: "", service_type: "Implementation", description: "", scope: "", exclusions: "", manager_id: "", start_date: new Date().toISOString().slice(0, 10), due_date: "", priority: "normal", budgeted_hours: "", budgeted_staff_cost: "", budgeted_expenses: "", contract_value: "", billing_arrangement: "Fixed fee", template_id: "" };
const staffName = (staff: Staff) => staff.full_name || staff.email || "Unnamed staff";
const display = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export function PracticeEngagementsPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const [clients, setClients] = useState<Client[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [form, setForm] = useState(initialForm);
  const [team, setTeam] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    const [clientResult, staffResult, templateResult, engagementResult] = await Promise.all([
      db.from("practice_clients").select("id,name").eq("organization_id", orgId).order("name"),
      db.from("staff").select("id,full_name,email").eq("organization_id", orgId).eq("is_active", true).order("full_name"),
      db.from("practice_workflow_templates").select("id,name,service_type,description").eq("organization_id", orgId).eq("is_active", true).order("name"),
      db.from("practice_engagements").select("id,engagement_number,title,service_type,status,priority,due_date,contract_value,budgeted_hours,client_id,responsible_manager_id").eq("organization_id", orgId).order("created_at", { ascending: false }),
    ]);
    const error = clientResult.error || staffResult.error || templateResult.error || engagementResult.error;
    if (error) setMessage(error.message);
    else {
      setClients(clientResult.data || []); setStaff(staffResult.data || []); setTemplates(templateResult.data || []); setEngagements(engagementResult.data || []);
      setForm((current) => ({ ...current, client_id: current.client_id || clientResult.data?.[0]?.id || "" }));
    }
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);
  const clientName = (id: string) => clients.find((client) => client.id === id)?.name || "Unknown client";
  const managerName = (id: string | null) => staff.find((person) => person.id === id) ? staffName(staff.find((person) => person.id === id)!) : "Unassigned";
  const selectedTemplate = templates.find((template) => template.id === form.template_id);
  const totals = useMemo(() => ({ active: engagements.filter((item) => !["completed", "closed"].includes(item.status)).length, due: engagements.filter((item) => item.due_date && item.due_date <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) && !["completed", "closed"].includes(item.status)).length }), [engagements]);

  const createEngagement = async () => {
    if (!orgId || !form.client_id || !form.title.trim()) { setMessage("Client and engagement title are required."); return; }
    setSaving(true); setMessage("");
    const number = `ENG-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    const insert = await db.from("practice_engagements").insert({ organization_id: orgId, client_id: form.client_id, engagement_number: number, title: form.title.trim(), service_type: form.service_type, description: form.description || null, scope: form.scope || null, exclusions: form.exclusions || null, responsible_manager_id: form.manager_id || null, start_date: form.start_date || null, due_date: form.due_date || null, priority: form.priority, status: "not_started", budgeted_hours: Number(form.budgeted_hours || 0), budgeted_staff_cost: Number(form.budgeted_staff_cost || 0), budgeted_expenses: Number(form.budgeted_expenses || 0), contract_value: Number(form.contract_value || 0), billing_arrangement: form.billing_arrangement }).select("id").single();
    if (insert.error) { setMessage(insert.error.message); setSaving(false); return; }
    const engagementId = insert.data.id;
    const assigned = Array.from(new Set([...(form.manager_id ? [form.manager_id] : []), ...team]));
    if (assigned.length) {
      const assignment = await db.from("practice_engagement_staff").insert(assigned.map((staffId) => ({ organization_id: orgId, engagement_id: engagementId, staff_id: staffId, assignment_role: staffId === form.manager_id ? "manager" : "team_member" })));
      if (assignment.error) setMessage(`Engagement created, but team assignment failed: ${assignment.error.message}`);
    }
    if (form.template_id) {
      const taskResult = await db.from("practice_workflow_template_tasks").select("title,description,sequence_no,due_offset_days,estimated_hours,requires_review").eq("template_id", form.template_id).order("sequence_no");
      if (!taskResult.error && taskResult.data?.length) {
        const base = new Date(`${form.start_date || new Date().toISOString().slice(0, 10)}T00:00:00`);
        const rows = (taskResult.data as TemplateTask[]).map((task) => { const due = new Date(base); due.setDate(due.getDate() + task.due_offset_days); return { organization_id: orgId, engagement_id: engagementId, client_id: form.client_id, title: task.title, description: task.description, due_date: due.toISOString().slice(0, 10), priority: form.priority, status: "not_started", estimated_hours: Number(task.estimated_hours || 0), assigned_to: team[0] || form.manager_id || null, reviewer_id: task.requires_review ? form.manager_id || null : null }; });
        const taskInsert = await db.from("practice_tasks").insert(rows);
        if (taskInsert.error) setMessage(`Engagement created, but workflow tasks failed: ${taskInsert.error.message}`);
      }
    }
    setForm({ ...initialForm, client_id: form.client_id }); setTeam([]); setSaving(false); await load();
    setMessage((current) => current || `${number} created${selectedTemplate ? ` with the ${selectedTemplate.name} workflow` : ""}.`);
  };

  return <div className="space-y-6 p-4 sm:p-6 md:p-8">{readOnly && <ReadOnlyNotice/>}
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Briefcase className="h-7 w-7 text-brand-700"/><h1 className="text-3xl font-bold text-slate-900">Engagements</h1></div><p className="mt-1 text-sm text-slate-500">Set up client work, responsible staff, delivery budgets and workflow tasks in one place.</p></div><button className="app-btn-secondary" onClick={() => void load()}><RefreshCw className="h-4 w-4"/> Refresh</button></div>
    {message && <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{message}</div>}
    <div className="grid gap-3 sm:grid-cols-2"><Metric icon={Briefcase} label="Active engagements" value={totals.active}/><Metric icon={CalendarClock} label="Due within 7 days" value={totals.due}/></div>
    <section className="rounded-xl border bg-white p-4"><h2 className="font-semibold text-slate-900">Create engagement</h2><p className="mb-4 text-xs text-slate-500">Choosing a workflow template automatically creates the standard tasks and deadlines.</p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><select className={input} value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })}><option value="">Select client *</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select><input className={input} placeholder="Engagement title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}/><select className={input} value={form.template_id} onChange={(e) => { const template = templates.find((item) => item.id === e.target.value); setForm({ ...form, template_id: e.target.value, service_type: template?.service_type || form.service_type }); }}><option value="">No workflow template</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select><input className={input} placeholder="Service type" value={form.service_type} onChange={(e) => setForm({ ...form, service_type: e.target.value })}/><select className={input} value={form.manager_id} onChange={(e) => setForm({ ...form, manager_id: e.target.value })}><option value="">Responsible manager</option>{staff.map((person) => <option key={person.id} value={person.id}>{staffName(person)}</option>)}</select><input className={input} type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })}/><input className={input} type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })}/><select className={input} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option value="low">Low priority</option><option value="normal">Normal priority</option><option value="high">High priority</option><option value="urgent">Urgent</option></select><textarea className={`${input} md:col-span-2`} placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}/><textarea className={`${input} md:col-span-2`} placeholder="Scope and deliverables" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}/><input className={input} type="number" min="0" placeholder="Budgeted hours" value={form.budgeted_hours} onChange={(e) => setForm({ ...form, budgeted_hours: e.target.value })}/><input className={input} type="number" min="0" placeholder="Budgeted staff cost" value={form.budgeted_staff_cost} onChange={(e) => setForm({ ...form, budgeted_staff_cost: e.target.value })}/><input className={input} type="number" min="0" placeholder="Budgeted expenses" value={form.budgeted_expenses} onChange={(e) => setForm({ ...form, budgeted_expenses: e.target.value })}/><input className={input} type="number" min="0" placeholder="Contract value" value={form.contract_value} onChange={(e) => setForm({ ...form, contract_value: e.target.value })}/><select className={input} value={form.billing_arrangement} onChange={(e) => setForm({ ...form, billing_arrangement: e.target.value })}><option>Fixed fee</option><option>Milestone</option><option>Hourly</option><option>Monthly retainer</option><option>Annual subscription</option><option>Time plus expenses</option></select><input className={input} placeholder="Exclusions" value={form.exclusions} onChange={(e) => setForm({ ...form, exclusions: e.target.value })}/></div>
      <div className="mt-4"><p className="mb-2 flex items-center gap-2 text-sm font-medium"><Users className="h-4 w-4"/> Assigned team</p><div className="flex flex-wrap gap-2">{staff.map((person) => <label key={person.id} className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs ${team.includes(person.id) ? "border-brand-500 bg-brand-50 text-brand-800" : "bg-white"}`}><input type="checkbox" className="sr-only" checked={team.includes(person.id)} onChange={() => setTeam(team.includes(person.id) ? team.filter((id) => id !== person.id) : [...team, person.id])}/>{staffName(person)}</label>)}</div></div>
      <button className="app-btn-primary mt-4" disabled={readOnly || saving || !form.client_id || !form.title.trim()} onClick={() => void createEngagement()}>{saving ? "Creating…" : "Create engagement and workflow"}</button>
    </section>
    <section className="overflow-hidden rounded-xl border bg-white"><div className="border-b p-4"><h2 className="font-semibold">Engagement register</h2></div><div className="overflow-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Number</th><th className="p-3">Client / engagement</th><th className="p-3">Manager</th><th className="p-3">Due</th><th className="p-3">Budget</th><th className="p-3">Contract value</th><th className="p-3">Status</th></tr></thead><tbody>{engagements.map((item) => <tr key={item.id} className="border-t"><td className="p-3 font-mono text-xs">{item.engagement_number || "—"}</td><td className="p-3"><p className="font-medium">{item.title}</p><p className="text-xs text-slate-500">{clientName(item.client_id)} · {item.service_type}</p></td><td className="p-3">{managerName(item.responsible_manager_id)}</td><td className="p-3">{item.due_date || "Not set"}</td><td className="p-3">{Number(item.budgeted_hours || 0).toLocaleString()} hrs</td><td className="p-3">UGX {Number(item.contract_value || 0).toLocaleString()}</td><td className="p-3">{display(item.status)}</td></tr>)}</tbody></table>{!engagements.length && <p className="p-8 text-center text-sm text-slate-500">No engagements yet.</p>}</div></section>
  </div>;
}

function Metric({ icon: Icon, label, value }: { icon: typeof Briefcase; label: string; value: number }) { return <div className="rounded-xl border bg-white p-4"><Icon className="mb-2 h-5 w-5 text-brand-700"/><p className="text-xs text-slate-500">{label}</p><p className="text-2xl font-bold">{value}</p></div>; }
