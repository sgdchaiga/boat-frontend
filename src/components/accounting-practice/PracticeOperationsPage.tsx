import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Briefcase, CheckCircle2, Clock3, RefreshCw, Users } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";
import { ReadOnlyNotice } from "../common/ReadOnlyNotice";

const db = supabase as any;
type Task = { id: string; title: string; due_date: string | null; status: string; priority: string; engagement_id: string | null; assigned_to: string | null; practice_engagements?: { title?: string } | null };
type Engagement = { id: string; title: string; status: string; due_date: string | null; delay_owner: string | null; responsible_manager_id: string | null };

const label = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const activeStatuses = ["not_started", "waiting_for_client", "in_progress", "under_review", "ready_for_delivery", "delivered", "invoiced", "open", "review"];

export function PracticeOperationsPage({ mode, readOnly = false, onNavigate }: { mode: "dashboard" | "my_work"; readOnly?: boolean; onNavigate?: (page: string) => void }) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const taskQuery = db.from("practice_tasks").select("id,title,due_date,status,priority,engagement_id,assigned_to,practice_engagements(title)").eq("organization_id", orgId).order("due_date", { ascending: true, nullsFirst: false });
    const [taskResult, engagementResult] = await Promise.all([
      mode === "my_work" ? taskQuery.eq("assigned_to", user?.id) : taskQuery,
      db.from("practice_engagements").select("id,title,status,due_date,delay_owner,responsible_manager_id").eq("organization_id", orgId),
    ]);
    if (taskResult.error || engagementResult.error) setMessage(taskResult.error?.message || engagementResult.error?.message);
    else { setTasks(taskResult.data || []); setEngagements(engagementResult.data || []); setMessage(""); }
    setLoading(false);
  }, [mode, orgId, user?.id]);

  useEffect(() => { void load(); }, [load]);
  const today = new Date().toISOString().slice(0, 10);
  const openTasks = useMemo(() => tasks.filter((task) => task.status !== "completed"), [tasks]);
  const overdue = openTasks.filter((task) => task.due_date && task.due_date < today);
  const dueToday = openTasks.filter((task) => task.due_date === today);
  const awaitingReview = openTasks.filter((task) => task.status === "under_review");
  const activeEngagements = engagements.filter((engagement) => activeStatuses.includes(engagement.status));
  const waitingForClient = engagements.filter((engagement) => engagement.status === "waiting_for_client");

  const updateTask = async (id: string, status: string) => {
    const result = await db.from("practice_tasks").update({ status, completed_at: status === "completed" ? new Date().toISOString() : null }).eq("id", id).eq("organization_id", orgId);
    if (result.error) setMessage(result.error.message); else await load();
  };

  return <div className="space-y-6 p-4 sm:p-6 md:p-8">
    {readOnly && <ReadOnlyNotice />}
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-3xl font-bold text-slate-900">{mode === "dashboard" ? "Practice operations" : "My Work"}</h1><p className="mt-1 text-sm text-slate-500">{mode === "dashboard" ? "Delivery control across engagements, deadlines and client delays." : "Your assigned tasks, deadlines, blockers and review work."}</p></div><button type="button" className="app-btn-secondary" onClick={() => void load()}><RefreshCw className="h-4 w-4"/> Refresh</button></div>
    {message && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{message}</div>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {mode === "dashboard" && <Metric icon={Briefcase} label="Active engagements" value={activeEngagements.length} tone="blue"/>}
      {mode === "dashboard" && <Metric icon={Users} label="Waiting for client" value={waitingForClient.length} tone="amber"/>}
      <Metric icon={AlertTriangle} label="Overdue tasks" value={overdue.length} tone="rose"/>
      <Metric icon={Clock3} label="Due today" value={dueToday.length} tone="amber"/>
      {mode === "my_work" && <Metric icon={CheckCircle2} label="Awaiting review" value={awaitingReview.length} tone="blue"/>}
      {mode === "my_work" && <Metric icon={Briefcase} label="Open assignments" value={openTasks.length} tone="slate"/>}
    </div>
    {mode === "dashboard" && <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5"><Drill label="Engagements" page="practice_engagements" go={onNavigate}/><Drill label="Document requests" page="practice_document_requests" go={onNavigate}/><Drill label="Support desk" page="practice_support" go={onNavigate}/><Drill label="Billing" page="practice_billing" go={onNavigate}/><Drill label="Profitability" page="practice_profitability" go={onNavigate}/></div>}
    <section className="overflow-hidden rounded-xl border bg-white"><div className="border-b px-4 py-3"><h2 className="font-semibold text-slate-900">{mode === "dashboard" ? "Priority work queue" : "Assigned work"}</h2><p className="text-xs text-slate-500">Earliest deadlines first. Every task remains connected to its engagement.</p></div>
      <div className="overflow-auto"><table className="w-full min-w-[760px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="p-3">Task</th><th className="p-3">Engagement</th><th className="p-3">Due</th><th className="p-3">Priority</th><th className="p-3">Status</th><th className="p-3">Action</th></tr></thead><tbody>{openTasks.map((task) => <tr key={task.id} className={`border-t ${task.due_date && task.due_date < today ? "bg-rose-50/60" : ""}`}><td className="p-3 font-medium text-slate-900">{task.title}</td><td className="p-3 text-slate-600">{task.practice_engagements?.title || "Not linked"}</td><td className="p-3">{task.due_date || "Not set"}</td><td className="p-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{label(task.priority)}</span></td><td className="p-3">{label(task.status)}</td><td className="p-3"><select className="rounded-lg border px-2 py-1.5" value={task.status} disabled={readOnly} onChange={(event) => void updateTask(task.id, event.target.value)}><option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="waiting_for_client">Waiting for client</option><option value="under_review">Under review</option><option value="returned">Returned</option><option value="completed">Completed</option></select></td></tr>)}</tbody></table>{!loading && !openTasks.length && <p className="p-8 text-center text-sm text-slate-500">No open work in this queue.</p>}</div>
    </section>
  </div>;
}

function Drill({ label, page, go }: { label: string; page: string; go?: (page: string) => void }) { return <button type="button" className="rounded-xl border bg-white px-4 py-3 text-left text-sm font-semibold text-brand-700 hover:bg-brand-50" onClick={() => go?.(page)}>Open {label} →</button>; }

function Metric({ icon: Icon, label: metricLabel, value, tone }: { icon: typeof Clock3; label: string; value: number; tone: "blue" | "amber" | "rose" | "slate" }) {
  const tones = { blue: "bg-blue-50 text-blue-700", amber: "bg-amber-50 text-amber-700", rose: "bg-rose-50 text-rose-700", slate: "bg-slate-100 text-slate-700" };
  return <div className="rounded-xl border bg-white p-4"><div className={`mb-3 inline-flex rounded-lg p-2 ${tones[tone]}`}><Icon className="h-5 w-5"/></div><p className="text-xs text-slate-500">{metricLabel}</p><p className="text-2xl font-bold text-slate-900">{value}</p></div>;
}
