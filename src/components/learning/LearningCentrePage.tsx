import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, BookOpen, CheckCircle2, ChevronRight, Film, GraduationCap, Search, Settings2, Wrench } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { PageIntroduction, TrainingProgress, type LearningArticle, useRoleVisibleArticles } from "./InAppLearning";

type Props = { onNavigate: (page: string) => void };
type ProgressRow = { content_type: string; content_key: string; status: string };
type TrainingTask = { id: string; module_key: string; page_key: string; role_keys: string[]; title: string; instructions: string; success_criteria: string[]; task_order: number; points: number };
type View = "lessons" | "practice" | "manage";

export function LearningCentrePage({ onNavigate }: Props) {
  const { user } = useAuth();
  const [articles, setArticles] = useState<LearningArticle[]>([]);
  const [tasks, setTasks] = useState<TrainingTask[]>([]);
  const [progress, setProgress] = useState<ProgressRow[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<LearningArticle | null>(null);
  const [view, setView] = useState<View>("lessons");
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState({ page_key: "", module_key: "practice", title: "", short_description: "", instructions: "" });
  const role = String(user?.role ?? "").toLowerCase();
  const canManage = user?.isSuperAdmin || ["admin", "manager", "super_admin", "owner"].includes(role);

  const load = useCallback(async () => {
    if (!user?.organization_id) return;
    const [a, t, p] = await Promise.all([
      (supabase as any).from("help_articles").select("*").eq("is_active", true).order("module_key").order("title"),
      (supabase as any).from("training_tasks").select("*").eq("is_active", true).order("task_order"),
      (supabase as any).from("user_training_progress").select("content_type,content_key,status").eq("organization_id", user.organization_id).eq("user_id", user.id),
    ]);
    if (a.error) setMessage("Learning content is not available yet. Apply the in-app learning migration.");
    else setArticles((a.data ?? []) as LearningArticle[]);
    if (!t.error) setTasks((t.data ?? []) as TrainingTask[]);
    if (!p.error) setProgress((p.data ?? []) as ProgressRow[]);
  }, [user?.id, user?.organization_id]);
  useEffect(() => { void load(); }, [load]);

  const visible = useRoleVisibleArticles(articles);
  const visibleTasks = useMemo(() => tasks.filter(t => !t.role_keys?.length || t.role_keys.map(x => x.toLowerCase()).includes(role)), [role, tasks]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return visible;
    return visible.filter(a => [a.title, a.short_description, a.module_key, a.page_key, ...(a.related_guidance ?? [])].join(" ").toLowerCase().includes(q));
  }, [query, visible]);
  const doneTasks = visibleTasks.filter(t => progress.some(p => p.content_type === "task" && p.content_key === t.id && p.status === "completed")).length;

  const completeTask = async (task: TrainingTask) => {
    if (!user?.organization_id || !user.id) return;
    const { error } = await (supabase as any).from("user_training_progress").upsert({ organization_id: user.organization_id, user_id: user.id, content_type: "task", content_key: task.id, status: "completed", progress: { points: task.points }, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "organization_id,user_id,content_type,content_key" });
    if (error) setMessage(error.message); else await load();
  };

  const saveArticle = async () => {
    if (!user?.organization_id || !draft.page_key.trim() || !draft.title.trim() || !draft.short_description.trim()) return;
    const { error } = await (supabase as any).from("help_articles").upsert({ organization_id: user.organization_id, page_key: draft.page_key.trim(), module_key: draft.module_key.trim() || "general", title: draft.title.trim(), short_description: draft.short_description.trim(), instructions: draft.instructions.split("\n").map(x => x.trim()).filter(Boolean), common_mistakes: [], related_guidance: [], troubleshooting: [], role_keys: [], version: 1, is_active: true, updated_at: new Date().toISOString() }, { onConflict: "organization_id,page_key,version" });
    if (error) setMessage(error.message); else { setDraft({ page_key: "", module_key: "practice", title: "", short_description: "", instructions: "" }); setMessage("Organization lesson saved."); await load(); }
  };

  return <div className="space-y-6 p-4 sm:p-6 md:p-8">
    <header><h1 className="text-3xl font-bold text-slate-900">Help & Learning Centre</h1><p className="mt-1 text-sm text-slate-500">Learn BOAT while you work. Guidance is filtered for your role and organization.</p></header>
    <PageIntroduction pageKey="learning_centre" title="Your self-learning workspace">Search for a task or accounting term, complete guided practice, then open the relevant BOAT page without leaving your workflow.</PageIntroduction>
    <div className="flex flex-wrap gap-2">
      <Tab active={view === "lessons"} onClick={() => setView("lessons")} icon={<BookOpen className="h-4 w-4"/>}>Lessons</Tab>
      <Tab active={view === "practice"} onClick={() => setView("practice")} icon={<GraduationCap className="h-4 w-4"/>}>Guided practice</Tab>
      {canManage && <Tab active={view === "manage"} onClick={() => setView("manage")} icon={<Settings2 className="h-4 w-4"/>}>Manage content</Tab>}
    </div>
    {view === "practice" && <TrainingActions canReset={Boolean(canManage)} onMessage={setMessage} />}
    {message && <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">{message}</div>}
    {view === "lessons" && <>
      <section className="grid gap-4 lg:grid-cols-[1fr_280px]"><div className="relative"><Search className="absolute left-3 top-3 h-5 w-5 text-slate-400"/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search client setup, reconciliation, journals, reports..." className="w-full rounded-xl border border-slate-300 py-2.5 pl-10 pr-4"/></div><div className="rounded-xl border bg-white p-3"><TrainingProgress completed={progress.filter(p => p.content_type === "article" && p.status === "completed").length} total={visible.length}/></div></section>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filtered.map(a => <button key={a.id} onClick={() => setSelected(a)} className="group rounded-xl border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md"><div className="flex items-start justify-between"><span className="rounded-full bg-brand-50 px-2 py-1 text-xs font-semibold capitalize text-brand-700">{a.module_key}</span><ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-brand-700"/></div><h2 className="mt-4 font-bold text-slate-900">{a.title}</h2><p className="mt-2 text-sm text-slate-600">{a.short_description}</p></button>)}</div>
    </>}
    {view === "practice" && <section className="space-y-4"><div className="rounded-xl border bg-white p-4"><TrainingProgress completed={doneTasks} total={visibleTasks.length}/></div>{visibleTasks.map((task, index) => { const done = progress.some(p => p.content_type === "task" && p.content_key === task.id && p.status === "completed"); return <article key={task.id} className={`rounded-xl border p-5 ${done ? "border-emerald-200 bg-emerald-50" : "bg-white"}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Task {index + 1} · {task.points} points</p><h2 className="mt-1 font-bold text-slate-900">{task.title}</h2><p className="mt-2 text-sm text-slate-600">{task.instructions}</p></div>{done && <CheckCircle2 className="h-6 w-6 text-emerald-600"/>}</div><ul className="mt-4 space-y-1 text-sm text-slate-600">{task.success_criteria.map(x => <li key={x}>• {x}</li>)}</ul><div className="mt-4 flex flex-wrap gap-2"><button className="app-btn-secondary" onClick={() => onNavigate(task.page_key)}>Open practice page</button><button className="app-btn-primary" disabled={done} onClick={() => void completeTask(task)}>{done ? "Completed" : "Mark complete"}</button></div></article>; })}</section>}
    {view === "manage" && canManage && <section className="rounded-xl border bg-white p-5"><h2 className="font-bold">Add organization guidance</h2><p className="mt-1 text-sm text-slate-500">Organization lessons override global BOAT guidance for the same page key.</p><div className="mt-4 grid gap-3 md:grid-cols-2"><input className="rounded-lg border px-3 py-2" placeholder="BOAT page key" value={draft.page_key} onChange={e => setDraft({...draft,page_key:e.target.value})}/><input className="rounded-lg border px-3 py-2" placeholder="Module key" value={draft.module_key} onChange={e => setDraft({...draft,module_key:e.target.value})}/><input className="rounded-lg border px-3 py-2 md:col-span-2" placeholder="Lesson title" value={draft.title} onChange={e => setDraft({...draft,title:e.target.value})}/><textarea className="rounded-lg border px-3 py-2 md:col-span-2" placeholder="Short description" value={draft.short_description} onChange={e => setDraft({...draft,short_description:e.target.value})}/><textarea className="min-h-32 rounded-lg border px-3 py-2 md:col-span-2" placeholder="One instruction per line" value={draft.instructions} onChange={e => setDraft({...draft,instructions:e.target.value})}/></div><button className="app-btn-primary mt-4" onClick={() => void saveArticle()}>Save lesson</button></section>}
    {selected && <LessonPanel article={selected} onClose={() => setSelected(null)} onNavigate={onNavigate}/>} 
  </div>;
}

function Tab({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) { return <button onClick={onClick} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${active ? "bg-slate-900 text-white" : "border bg-white text-slate-700"}`}>{icon}{children}</button>; }

function LessonPanel({ article, onClose, onNavigate }: { article: LearningArticle; onClose: () => void; onNavigate: (page: string) => void }) { return <div className="fixed inset-0 z-[110] flex justify-end bg-slate-950/30" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><aside className="h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-2xl"><button onClick={onClose} className="float-right text-sm text-slate-500">Close</button><p className="text-xs font-semibold uppercase tracking-wide text-brand-700">{article.module_key} lesson</p><h2 className="mt-2 text-2xl font-bold">{article.title}</h2><p className="mt-2 text-slate-600">{article.short_description}</p>{article.media_url && <div className="mt-5 overflow-hidden rounded-xl border"><div className="flex items-center gap-2 bg-slate-50 p-3 text-sm font-medium"><Film className="h-4 w-4"/> Short demonstration</div>{article.media_type === "mp4" ? <video src={article.media_url} controls className="w-full"/> : <img src={article.media_url} alt={`${article.title} demonstration`} className="w-full"/>}</div>}<LessonList icon={<BookOpen className="h-5 w-5"/>} title="Steps" items={article.instructions}/><LessonList icon={<AlertTriangle className="h-5 w-5 text-amber-600"/>} title="Common mistakes" items={article.common_mistakes}/><LessonList icon={<Wrench className="h-5 w-5 text-blue-600"/>} title="Troubleshooting" items={article.troubleshooting}/><button className="app-btn-primary mt-6 w-full justify-center" onClick={() => { onNavigate(article.page_key); onClose(); }}>Open this BOAT page <ChevronRight className="h-4 w-4"/></button></aside></div>; }

function LessonList({ icon, title, items }: { icon: ReactNode; title: string; items: string[] }) { if (!items?.length) return null; return <section className="mt-6"><h3 className="flex items-center gap-2 font-semibold">{icon}{title}</h3><ol className="mt-3 space-y-2">{items.map((x, i) => <li key={`${title}-${i}`} className="flex gap-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"/>{x}</li>)}</ol></section>; }

function TrainingActions({ canReset, onMessage }: { canReset: boolean; onMessage: (message: string) => void }) {
  const { user } = useAuth();
  const reset = async () => {
    if (!user?.organization_id || !window.confirm("Reset Kampala Traders training data to its original state?")) return;
    const { error } = await supabase.rpc("reset_practice_training_account", { p_organization_id: user.organization_id });
    onMessage(error ? error.message : "Kampala Traders training account is ready. Existing training data was reset; live clients were untouched.");
  };
  const certificate = async () => {
    if (!user?.organization_id) return;
    const { data, error } = await supabase.rpc("issue_training_certificate", { p_organization_id: user.organization_id, p_module_key: "practice" });
    const row = data as { certificate_number?: string } | null;
    onMessage(error ? error.message : `Certificate issued: ${row?.certificate_number ?? "available in your learning record"}.`);
  };
  return <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4"><div><h2 className="font-semibold text-violet-950">Protected practice environment</h2><p className="text-sm text-violet-800">Exercises use Kampala Traders Ltd - Training Account and remain separate from live clients.</p></div><div className="flex flex-wrap gap-2">{canReset && <button className="app-btn-secondary" onClick={() => void reset()}>Create / reset training account</button>}<button className="app-btn-primary" onClick={() => void certificate()}>Request certificate</button></div></section>;
}
