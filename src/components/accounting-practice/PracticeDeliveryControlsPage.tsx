import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileQuestion, Headphones, RefreshCw } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";
import { ReadOnlyNotice } from "../common/ReadOnlyNotice";

const db = supabase as any;
const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100";
type Client = { id: string; name: string };
type Engagement = { id: string; title: string; client_id: string };
type Staff = { id: string; full_name: string; email: string };
type DocumentRequest = { id: string; client_id: string; engagement_id: string | null; title: string; category: string; due_date: string | null; status: string; responsible_staff_id: string | null };
type Ticket = { id: string; client_id: string; engagement_id: string | null; ticket_number: string; title: string; module: string | null; priority: string; status: string; assigned_to: string | null; response_due_at: string | null; resolution_due_at: string | null; chargeable: boolean };
const display = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const staffLabel = (person?: Staff) => person?.full_name || person?.email || "Unassigned";

export function PracticeDeliveryControlsPage({ mode, readOnly = false }: { mode: "requests" | "support"; readOnly?: boolean }) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const [clients, setClients] = useState<Client[]>([]);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [requests, setRequests] = useState<DocumentRequest[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ priority: "normal", category: mode === "support" ? "General support" : "Other", chargeable: "false" });

  const load = useCallback(async () => {
    if (!orgId) return;
    const recordQuery = mode === "requests"
      ? db.from("practice_document_requests").select("id,client_id,engagement_id,title,category,due_date,status,responsible_staff_id").eq("organization_id", orgId).order("created_at", { ascending: false })
      : db.from("practice_support_tickets").select("id,client_id,engagement_id,ticket_number,title,module,priority,status,assigned_to,response_due_at,resolution_due_at,chargeable").eq("organization_id", orgId).order("reported_at", { ascending: false });
    const [clientResult, engagementResult, staffResult, recordResult] = await Promise.all([
      db.from("practice_clients").select("id,name").eq("organization_id", orgId).order("name"),
      db.from("practice_engagements").select("id,title,client_id").eq("organization_id", orgId).order("title"),
      db.from("staff").select("id,full_name,email").eq("organization_id", orgId).eq("is_active", true).order("full_name"),
      recordQuery,
    ]);
    const error = clientResult.error || engagementResult.error || staffResult.error || recordResult.error;
    if (error) setMessage(error.message);
    else {
      setClients(clientResult.data || []); setEngagements(engagementResult.data || []); setStaff(staffResult.data || []);
      if (mode === "requests") setRequests(recordResult.data || []); else setTickets(recordResult.data || []);
      setForm((current) => ({ ...current, client_id: current.client_id || clientResult.data?.[0]?.id || "" }));
    }
  }, [mode, orgId]);
  useEffect(() => { void load(); }, [load]);

  const relevantEngagements = engagements.filter((engagement) => !form.client_id || engagement.client_id === form.client_id);
  const clientName = (id: string) => clients.find((client) => client.id === id)?.name || "Unknown client";
  const engagementName = (id: string | null) => engagements.find((engagement) => engagement.id === id)?.title || "Not linked";
  const assigneeName = (id: string | null) => staffLabel(staff.find((person) => person.id === id));
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const metrics = useMemo(() => mode === "requests" ? {
    open: requests.filter((item) => !["accepted", "waived"].includes(item.status)).length,
    overdue: requests.filter((item) => item.due_date && item.due_date < today && !["accepted", "waived"].includes(item.status)).length,
  } : {
    open: tickets.filter((item) => !["resolved", "closed"].includes(item.status)).length,
    overdue: tickets.filter((item) => item.resolution_due_at && item.resolution_due_at < now && !["resolved", "closed"].includes(item.status)).length,
  }, [mode, now, requests, tickets, today]);

  const create = async () => {
    if (!orgId || !form.client_id || !form.title?.trim()) { setMessage("Client and title are required."); return; }
    setSaving(true); setMessage("");
    if (mode === "requests") {
      const result = await db.from("practice_document_requests").insert({ organization_id: orgId, client_id: form.client_id, engagement_id: form.engagement_id || null, title: form.title.trim(), description: form.description || null, category: form.category || "Other", requested_by: user?.id || null, responsible_staff_id: form.assigned_to || null, due_date: form.due_date || null, status: "requested" });
      if (result.error) setMessage(result.error.message); else setMessage("Client document request created.");
    } else {
      const reported = new Date(); const responseDue = new Date(reported); const resolutionDue = new Date(reported);
      const hours = form.priority === "critical" ? [1, 4] : form.priority === "urgent" ? [2, 8] : form.priority === "high" ? [4, 24] : form.priority === "normal" ? [8, 48] : [24, 72];
      responseDue.setHours(responseDue.getHours() + hours[0]); resolutionDue.setHours(resolutionDue.getHours() + hours[1]);
      const result = await db.from("practice_support_tickets").insert({ organization_id: orgId, client_id: form.client_id, engagement_id: form.engagement_id || null, ticket_number: `SUP-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`, title: form.title.trim(), description: form.description || form.title.trim(), module: form.module || null, category: form.category || "General support", priority: form.priority || "normal", business_impact: form.business_impact || null, assigned_to: form.assigned_to || null, reported_by_name: form.reported_by_name || null, response_due_at: responseDue.toISOString(), resolution_due_at: resolutionDue.toISOString(), chargeable: form.chargeable === "true" });
      if (result.error) setMessage(result.error.message); else setMessage("Support ticket created with SLA targets.");
    }
    setSaving(false); setForm({ priority: "normal", category: mode === "support" ? "General support" : "Other", chargeable: "false", client_id: form.client_id }); await load();
  };

  const updateStatus = async (id: string, status: string) => {
    const table = mode === "requests" ? "practice_document_requests" : "practice_support_tickets";
    const payload: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    if (mode === "requests" && status === "received") payload.received_at = new Date().toISOString();
    if (mode === "requests" && status === "accepted") { payload.reviewed_at = new Date().toISOString(); payload.reviewed_by = user?.id || null; }
    if (mode === "support" && status === "acknowledged") payload.first_responded_at = new Date().toISOString();
    if (mode === "support" && status === "resolved") payload.resolved_at = new Date().toISOString();
    const result = await db.from(table).update(payload).eq("id", id).eq("organization_id", orgId);
    if (result.error) setMessage(result.error.message); else await load();
  };

  const Icon = mode === "requests" ? FileQuestion : Headphones;
  return <div className="space-y-6 p-4 sm:p-6 md:p-8">{readOnly && <ReadOnlyNotice/>}
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Icon className="h-7 w-7 text-brand-700"/><h1 className="text-3xl font-bold text-slate-900">{mode === "requests" ? "Document Requests" : "Support Desk"}</h1></div><p className="mt-1 text-sm text-slate-500">{mode === "requests" ? "Track client information from request through receipt and acceptance." : "Control response, resolution, ownership and chargeability of client issues."}</p></div><button className="app-btn-secondary" onClick={() => void load()}><RefreshCw className="h-4 w-4"/> Refresh</button></div>
    {message && <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{message}</div>}
    <div className="grid gap-3 sm:grid-cols-2"><Metric label={mode === "requests" ? "Open requests" : "Open tickets"} value={metrics.open}/><Metric label={mode === "requests" ? "Overdue requests" : "SLA overdue"} value={metrics.overdue} alert/></div>
    <section className="rounded-xl border bg-white p-4"><h2 className="mb-4 font-semibold">{mode === "requests" ? "Request client document" : "Log support ticket"}</h2><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <select className={input} value={form.client_id || ""} onChange={(e) => setForm({ ...form, client_id: e.target.value, engagement_id: "" })}><option value="">Select client *</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select><select className={input} value={form.engagement_id || ""} onChange={(e) => setForm({ ...form, engagement_id: e.target.value })}><option value="">No linked engagement</option>{relevantEngagements.map((engagement) => <option key={engagement.id} value={engagement.id}>{engagement.title}</option>)}</select><input className={input} placeholder={mode === "requests" ? "Document required *" : "Issue title *"} value={form.title || ""} onChange={(e) => setForm({ ...form, title: e.target.value })}/><input className={input} placeholder="Category" value={form.category || ""} onChange={(e) => setForm({ ...form, category: e.target.value })}/><select className={input} value={form.assigned_to || ""} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}><option value="">Responsible staff</option>{staff.map((person) => <option key={person.id} value={person.id}>{staffLabel(person)}</option>)}</select>
      {mode === "requests" ? <input className={input} type="date" value={form.due_date || ""} onChange={(e) => setForm({ ...form, due_date: e.target.value })}/> : <><select className={input} value={form.priority || "normal"} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option><option value="critical">Critical</option></select><input className={input} placeholder="BOAT module" value={form.module || ""} onChange={(e) => setForm({ ...form, module: e.target.value })}/><input className={input} placeholder="Business impact" value={form.business_impact || ""} onChange={(e) => setForm({ ...form, business_impact: e.target.value })}/><select className={input} value={form.chargeable || "false"} onChange={(e) => setForm({ ...form, chargeable: e.target.value })}><option value="false">Covered by support</option><option value="true">Chargeable</option></select></>}
      <textarea className={`${input} md:col-span-2 xl:col-span-4`} placeholder="Description and instructions" value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })}/></div><button className="app-btn-primary mt-4" disabled={readOnly || saving || !form.client_id || !form.title?.trim()} onClick={() => void create()}>{saving ? "Saving…" : mode === "requests" ? "Send request" : "Create ticket"}</button></section>
    {mode === "requests" ? <RequestTable rows={requests} clientName={clientName} engagementName={engagementName} assigneeName={assigneeName} readOnly={readOnly} updateStatus={updateStatus} today={today}/> : <TicketTable rows={tickets} clientName={clientName} engagementName={engagementName} assigneeName={assigneeName} readOnly={readOnly} updateStatus={updateStatus} now={now}/>} 
  </div>;
}

function RequestTable({ rows, clientName, engagementName, assigneeName, readOnly, updateStatus, today }: any) { return <section className="overflow-hidden rounded-xl border bg-white"><div className="overflow-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Document</th><th className="p-3">Client / engagement</th><th className="p-3">Owner</th><th className="p-3">Due</th><th className="p-3">Status</th></tr></thead><tbody>{rows.map((row: DocumentRequest) => <tr key={row.id} className={`border-t ${row.due_date && row.due_date < today && !["accepted","waived"].includes(row.status) ? "bg-rose-50" : ""}`}><td className="p-3"><p className="font-medium">{row.title}</p><p className="text-xs text-slate-500">{row.category}</p></td><td className="p-3"><p>{clientName(row.client_id)}</p><p className="text-xs text-slate-500">{engagementName(row.engagement_id)}</p></td><td className="p-3">{assigneeName(row.responsible_staff_id)}</td><td className="p-3">{row.due_date || "Not set"}</td><td className="p-3"><select className="rounded-lg border px-2 py-1.5" disabled={readOnly} value={row.status} onChange={(e) => void updateStatus(row.id, e.target.value)}><option value="requested">Requested</option><option value="partially_received">Partially received</option><option value="received">Received</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option><option value="waived">Waived</option></select></td></tr>)}</tbody></table>{!rows.length && <p className="p-8 text-center text-sm text-slate-500">No document requests.</p>}</div></section>; }
function TicketTable({ rows, clientName, engagementName, assigneeName, readOnly, updateStatus, now }: any) { return <section className="overflow-hidden rounded-xl border bg-white"><div className="overflow-auto"><table className="w-full min-w-[1000px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Ticket</th><th className="p-3">Client / engagement</th><th className="p-3">Owner</th><th className="p-3">Priority</th><th className="p-3">Resolution target</th><th className="p-3">Status</th></tr></thead><tbody>{rows.map((row: Ticket) => <tr key={row.id} className={`border-t ${row.resolution_due_at && row.resolution_due_at < now && !["resolved","closed"].includes(row.status) ? "bg-rose-50" : ""}`}><td className="p-3"><p className="font-medium">{row.title}</p><p className="font-mono text-xs text-slate-500">{row.ticket_number}{row.module ? ` · ${row.module}` : ""}{row.chargeable ? " · Chargeable" : ""}</p></td><td className="p-3"><p>{clientName(row.client_id)}</p><p className="text-xs text-slate-500">{engagementName(row.engagement_id)}</p></td><td className="p-3">{assigneeName(row.assigned_to)}</td><td className="p-3">{display(row.priority)}</td><td className="p-3">{row.resolution_due_at ? new Date(row.resolution_due_at).toLocaleString() : "Not set"}</td><td className="p-3"><select className="rounded-lg border px-2 py-1.5" disabled={readOnly} value={row.status} onChange={(e) => void updateStatus(row.id, e.target.value)}><option value="open">Open</option><option value="acknowledged">Acknowledged</option><option value="in_progress">In progress</option><option value="waiting_for_client">Waiting for client</option><option value="escalated">Escalated</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></td></tr>)}</tbody></table>{!rows.length && <p className="p-8 text-center text-sm text-slate-500">No support tickets.</p>}</div></section>; }
function Metric({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) { return <div className={`rounded-xl border p-4 ${alert && value ? "border-rose-200 bg-rose-50" : "bg-white"}`}>{alert && <AlertTriangle className="mb-2 h-5 w-5 text-rose-600"/>}<p className="text-xs text-slate-500">{label}</p><p className="text-2xl font-bold">{value}</p></div>; }
