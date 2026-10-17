import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, BookOpen, CheckCircle2, ChevronRight, Film, GraduationCap, Search, Settings2, Wrench } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { PageIntroduction, TrainingProgress, type LearningArticle, useRoleVisibleArticles } from "./InAppLearning";

type Props = { onNavigate: (page: string) => void };
type ProgressRow = { content_type: string; content_key: string; status: string };
type TrainingTask = { id: string; module_key: string; page_key: string; role_keys: string[]; title: string; instructions: string; success_criteria: string[]; task_order: number; points: number };
type AcademyLesson = { lesson_order: number; is_required: boolean; academy_lesson_versions: { id: string; title: string; summary: string; content: Array<{ type?: string; text?: string; url?: string }> } | null };
type AcademyAssignment = { id: string; status: string; due_at: string | null; academy_course_versions: { title: string; summary: string; academy_course_lessons: AcademyLesson[]; academy_assessments?: { id: string; title: string }[] } | null };
type ManagerProgress = { user_id: string; full_name: string; role: string; assigned: number; completed: number; overdue: number; completion_percent: number };
type View = "lessons" | "practice" | "manage";

export function LearningCentrePage({ onNavigate }: Props) {
  const { user } = useAuth();
  const [articles, setArticles] = useState<LearningArticle[]>([]);
  const [tasks, setTasks] = useState<TrainingTask[]>([]);
  const [progress, setProgress] = useState<ProgressRow[]>([]);
  const [assignments, setAssignments] = useState<AcademyAssignment[]>([]);
  const [managerProgress, setManagerProgress] = useState<ManagerProgress[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<LearningArticle | null>(null);
  const [selectedAssignment, setSelectedAssignment] = useState<AcademyAssignment | null>(null);
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<string | null>(null);
  const [view, setView] = useState<View>("lessons");
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState({ page_key: "", module_key: "general", title: "", short_description: "", instructions: "", media_url: "", media_type: "" as "" | "gif" | "mp4" | "web" });
  const [academyDraft, setAcademyDraft] = useState({ course_key: "", course_title: "", summary: "", module_key: "general", page_key: "", lesson_title: "", lesson_summary: "", lesson_steps: "", release_key: "", due_days: "14" });
  const role = String(user?.role ?? "").toLowerCase();
  const canManage = user?.isSuperAdmin || ["admin", "manager", "super_admin", "owner"].includes(role);

  const load = useCallback(async () => {
    if (!user?.organization_id) return;
    const [a, t, p, assigned, report] = await Promise.all([
      (supabase as any).from("help_articles").select("*").eq("is_active", true).order("module_key").order("title"),
      (supabase as any).from("training_tasks").select("*").eq("is_active", true).order("task_order"),
      (supabase as any).from("user_training_progress").select("content_type,content_key,status").eq("organization_id", user.organization_id).eq("user_id", user.id),
      (supabase as any).from("academy_user_assignments").select("id,status,due_at,academy_course_versions(title,summary,academy_course_lessons(lesson_order,is_required,academy_lesson_versions(id,title,summary,content)),academy_assessments(id,title))").eq("organization_id", user.organization_id).eq("user_id", user.id).order("due_at", { ascending: true }),
      canManage ? (supabase as any).rpc("academy_manager_progress", { p_organization_id: user.organization_id }) : Promise.resolve({ data: [], error: null }),
    ]);
    if (a.error) setMessage("Learning content is not available yet. Apply the in-app learning migration.");
    else setArticles((a.data ?? []) as LearningArticle[]);
    if (!t.error) setTasks((t.data ?? []) as TrainingTask[]);
    if (!p.error) setProgress((p.data ?? []) as ProgressRow[]);
    if (!assigned.error) setAssignments((assigned.data ?? []) as AcademyAssignment[]);
    if (!report.error) setManagerProgress((report.data ?? []) as ManagerProgress[]);
  }, [canManage, user?.id, user?.organization_id]);
  useEffect(() => { void load(); }, [load]);

  const roleVisible = useRoleVisibleArticles(articles);
  const visible = useMemo(() => {
    const moduleByBusiness: Record<string, string[]> = {
      hotel: ["frontdesk", "hotel_pos", "general", "accounting"], retail: ["retail_pos", "inventory", "general", "accounting"],
      sacco: ["sacco", "general", "accounting"], school: ["school", "general", "accounting"],
      manufacturing: ["manufacturing", "inventory", "general", "accounting"], accounting_practice: ["practice", "accounting", "general"],
    };
    const allowed = moduleByBusiness[String(user?.business_type ?? "")] ?? null;
    return allowed ? roleVisible.filter(article => allowed.includes(article.module_key)) : roleVisible;
  }, [roleVisible, user?.business_type]);
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
    const { error } = await (supabase as any).from("help_articles").upsert({ organization_id: user.organization_id, page_key: draft.page_key.trim(), module_key: draft.module_key.trim() || "general", title: draft.title.trim(), short_description: draft.short_description.trim(), instructions: draft.instructions.split("\n").map(x => x.trim()).filter(Boolean), common_mistakes: [], related_guidance: [], troubleshooting: [], media_url: draft.media_url.trim() || null, media_type: draft.media_type || null, role_keys: [], version: 1, is_active: true, updated_at: new Date().toISOString() }, { onConflict: "organization_id,page_key,version" });
    if (error) setMessage(error.message); else { setDraft({ page_key: "", module_key: "general", title: "", short_description: "", instructions: "", media_url: "", media_type: "" }); setMessage("Organization lesson saved."); await load(); }
  };
  const publishCourse = async () => {
    if (!user?.organization_id || !academyDraft.course_key.trim() || !academyDraft.course_title.trim() || !academyDraft.lesson_title.trim()) return;
    const p_content = academyDraft.lesson_steps.split("\n").map(text => text.trim()).filter(Boolean).map(text => ({ type: "text", text }));
    const { error } = await (supabase as any).rpc("publish_organization_academy_course", { p_organization_id: user.organization_id, p_course_key: academyDraft.course_key, p_course_title: academyDraft.course_title, p_course_summary: academyDraft.summary, p_module_key: academyDraft.module_key, p_page_key: academyDraft.page_key, p_lesson_title: academyDraft.lesson_title, p_lesson_summary: academyDraft.lesson_summary, p_content, p_role_keys: [], p_release_key: academyDraft.release_key || null, p_due_days: Number(academyDraft.due_days) || 14 });
    if (error) setMessage(error.message); else { setAcademyDraft({ course_key: "", course_title: "", summary: "", module_key: "general", page_key: "", lesson_title: "", lesson_summary: "", lesson_steps: "", release_key: "", due_days: "14" }); setMessage("Academy course published. A release key automatically assigns it to matching staff."); await load(); }
  };

  return <div className="space-y-6 p-4 sm:p-6 md:p-8">
    <header><h1 className="text-3xl font-bold text-slate-900">BOAT Academy & Training Centre</h1><p className="mt-1 text-sm text-slate-500">Learn BOAT while you work. Training is matched to your organization, modules and role.</p></header>
    <PageIntroduction pageKey="learning_centre" title="Your self-learning workspace">Search for a task or accounting term, complete guided practice, then open the relevant BOAT page without leaving your workflow.</PageIntroduction>
    <div className="flex flex-wrap gap-2">
      <Tab active={view === "lessons"} onClick={() => setView("lessons")} icon={<BookOpen className="h-4 w-4"/>}>Lessons</Tab>
      <Tab active={view === "practice"} onClick={() => setView("practice")} icon={<GraduationCap className="h-4 w-4"/>}>Guided practice</Tab>
      {canManage && <Tab active={view === "manage"} onClick={() => setView("manage")} icon={<Settings2 className="h-4 w-4"/>}>Manage content</Tab>}
    </div>
    {view === "practice" && <TrainingActions canReset={Boolean(canManage)} onMessage={setMessage} />}
    {message && <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">{message}</div>}
    {view === "manage" && canManage && <section className="rounded-xl border bg-white p-5"><h2 className="font-bold">Publish an Academy course</h2><p className="mt-1 text-sm text-slate-500">A release key assigns the published course to your staff automatically.</p><div className="mt-4 grid gap-3 md:grid-cols-2"><input className="rounded-lg border px-3 py-2" placeholder="Course key" value={academyDraft.course_key} onChange={e => setAcademyDraft({...academyDraft,course_key:e.target.value})}/><input className="rounded-lg border px-3 py-2" placeholder="Course title" value={academyDraft.course_title} onChange={e => setAcademyDraft({...academyDraft,course_title:e.target.value})}/><textarea className="rounded-lg border px-3 py-2 md:col-span-2" placeholder="Course summary" value={academyDraft.summary} onChange={e => setAcademyDraft({...academyDraft,summary:e.target.value})}/><input className="rounded-lg border px-3 py-2" placeholder="Module key" value={academyDraft.module_key} onChange={e => setAcademyDraft({...academyDraft,module_key:e.target.value})}/><input className="rounded-lg border px-3 py-2" placeholder="Relevant page key (optional)" value={academyDraft.page_key} onChange={e => setAcademyDraft({...academyDraft,page_key:e.target.value})}/><input className="rounded-lg border px-3 py-2" placeholder="First lesson title" value={academyDraft.lesson_title} onChange={e => setAcademyDraft({...academyDraft,lesson_title:e.target.value})}/><input className="rounded-lg border px-3 py-2" placeholder="Lesson summary" value={academyDraft.lesson_summary} onChange={e => setAcademyDraft({...academyDraft,lesson_summary:e.target.value})}/><textarea className="min-h-28 rounded-lg border px-3 py-2 md:col-span-2" placeholder="One lesson step per line" value={academyDraft.lesson_steps} onChange={e => setAcademyDraft({...academyDraft,lesson_steps:e.target.value})}/><input className="rounded-lg border px-3 py-2" placeholder="Feature release key (optional)" value={academyDraft.release_key} onChange={e => setAcademyDraft({...academyDraft,release_key:e.target.value})}/><input className="rounded-lg border px-3 py-2" type="number" min="0" placeholder="Days to complete" value={academyDraft.due_days} onChange={e => setAcademyDraft({...academyDraft,due_days:e.target.value})}/></div><button className="app-btn-primary mt-4" onClick={() => void publishCourse()}>Publish Academy course</button></section>}
    {view === "lessons" && <>
      {assignments.length > 0 && <section className="rounded-xl border border-indigo-200 bg-indigo-50 p-4"><div className="flex items-center gap-2"><GraduationCap className="h-5 w-5 text-indigo-700"/><h2 className="font-bold text-indigo-950">Assigned training</h2></div><div className="mt-3 grid gap-3 md:grid-cols-2">{assignments.map(assignment => <article key={assignment.id} className="rounded-lg border border-indigo-100 bg-white p-3"><p className="font-semibold text-slate-900">{assignment.academy_course_versions?.title ?? "BOAT training course"}</p><p className="mt-1 text-sm text-slate-600">{assignment.academy_course_versions?.summary ?? "Complete the required lessons for this update."}</p><div className="mt-3 flex items-center justify-between gap-2"><button className="app-btn-secondary text-xs" onClick={() => setSelectedAssignment(assignment)}>Open course</button><div className="text-right text-xs"><span className="block font-semibold capitalize text-indigo-700">{assignment.status.replace("_", " ")}</span>{assignment.due_at && <span className="text-slate-500">Due {new Date(assignment.due_at).toLocaleDateString()}</span>}</div></div></article>)}</div></section>}
      <section className="grid gap-4 lg:grid-cols-[1fr_280px]"><div className="relative"><Search className="absolute left-3 top-3 h-5 w-5 text-slate-400"/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search client setup, reconciliation, journals, reports..." className="w-full rounded-xl border border-slate-300 py-2.5 pl-10 pr-4"/></div><div className="rounded-xl border bg-white p-3"><TrainingProgress completed={progress.filter(p => p.content_type === "article" && p.status === "completed").length} total={visible.length}/></div></section>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filtered.map(a => <button key={a.id} onClick={() => setSelected(a)} className="group rounded-xl border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md"><div className="flex items-start justify-between"><span className="rounded-full bg-brand-50 px-2 py-1 text-xs font-semibold capitalize text-brand-700">{a.module_key}</span><ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-brand-700"/></div><h2 className="mt-4 font-bold text-slate-900">{a.title}</h2><p className="mt-2 text-sm text-slate-600">{a.short_description}</p></button>)}</div>
    </>}
    {view === "practice" && <section className="space-y-4"><div className="rounded-xl border bg-white p-4"><TrainingProgress completed={doneTasks} total={visibleTasks.length}/></div>{visibleTasks.map((task, index) => { const done = progress.some(p => p.content_type === "task" && p.content_key === task.id && p.status === "completed"); return <article key={task.id} className={`rounded-xl border p-5 ${done ? "border-emerald-200 bg-emerald-50" : "bg-white"}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Task {index + 1} · {task.points} points</p><h2 className="mt-1 font-bold text-slate-900">{task.title}</h2><p className="mt-2 text-sm text-slate-600">{task.instructions}</p></div>{done && <CheckCircle2 className="h-6 w-6 text-emerald-600"/>}</div><ul className="mt-4 space-y-1 text-sm text-slate-600">{task.success_criteria.map(x => <li key={x}>• {x}</li>)}</ul><div className="mt-4 flex flex-wrap gap-2"><button className="app-btn-secondary" onClick={() => onNavigate(task.page_key)}>Open practice page</button><button className="app-btn-primary" disabled={done} onClick={() => void completeTask(task)}>{done ? "Completed" : "Mark complete"}</button></div></article>; })}</section>}
    {view === "manage" && canManage && <section className="space-y-5"><div className="rounded-xl border bg-white p-5"><h2 className="font-bold">Add organization guidance</h2><p className="mt-1 text-sm text-slate-500">Organization lessons override global BOAT guidance for the same page key. Use a streamed video URL or image URL; do not upload large files to the application bundle.</p><div className="mt-4 grid gap-3 md:grid-cols-2"><input className="rounded-lg border px-3 py-2" placeholder="BOAT page key" value={draft.page_key} onChange={e => setDraft({...draft,page_key:e.target.value})}/><input className="rounded-lg border px-3 py-2" placeholder="Module key" value={draft.module_key} onChange={e => setDraft({...draft,module_key:e.target.value})}/><input className="rounded-lg border px-3 py-2 md:col-span-2" placeholder="Lesson title" value={draft.title} onChange={e => setDraft({...draft,title:e.target.value})}/><textarea className="rounded-lg border px-3 py-2 md:col-span-2" placeholder="Short description" value={draft.short_description} onChange={e => setDraft({...draft,short_description:e.target.value})}/><textarea className="min-h-32 rounded-lg border px-3 py-2 md:col-span-2" placeholder="One instruction per line" value={draft.instructions} onChange={e => setDraft({...draft,instructions:e.target.value})}/><input className="rounded-lg border px-3 py-2" placeholder="Video or screenshot URL (optional)" value={draft.media_url} onChange={e => setDraft({...draft,media_url:e.target.value})}/><select className="rounded-lg border px-3 py-2" value={draft.media_type} onChange={e => setDraft({...draft,media_type:e.target.value as typeof draft.media_type})}><option value="">No media</option><option value="mp4">Video (MP4/stream)</option><option value="gif">GIF</option><option value="web">Screenshot / web image</option></select></div><button className="app-btn-primary mt-4" onClick={() => void saveArticle()}>Save lesson</button></div><div className="rounded-xl border bg-white p-5"><h2 className="font-bold">Team training progress</h2><p className="mt-1 text-sm text-slate-500">Only staff in this organization are shown.</p>{managerProgress.length ? <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b text-slate-500"><tr><th className="pb-2">Staff member</th><th className="pb-2">Role</th><th className="pb-2">Completed</th><th className="pb-2">Overdue</th><th className="pb-2">Progress</th></tr></thead><tbody>{managerProgress.map(row => <tr key={row.user_id} className="border-b last:border-0"><td className="py-2 font-medium">{row.full_name}</td><td className="py-2 capitalize">{row.role?.replaceAll("_", " ")}</td><td className="py-2">{row.completed}/{row.assigned}</td><td className="py-2 text-amber-700">{row.overdue}</td><td className="py-2">{row.completion_percent}%</td></tr>)}</tbody></table></div> : <p className="mt-4 text-sm text-slate-500">No Academy assignments have been issued for this organization yet.</p>}</div></section>}
    {selected && <LessonPanel article={selected} onClose={() => setSelected(null)} onNavigate={onNavigate}/>} 
    {selectedAssignment && <AcademyCoursePanel assignment={selectedAssignment} onClose={() => setSelectedAssignment(null)} onComplete={() => void load()} onAssessment={(id) => setSelectedAssessmentId(id)} />}
    {selectedAssessmentId && <AcademyAssessmentPanel assessmentId={selectedAssessmentId} onClose={() => setSelectedAssessmentId(null)} onComplete={() => void load()} />}
  </div>;
}

function Tab({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) { return <button onClick={onClick} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${active ? "bg-slate-900 text-white" : "border bg-white text-slate-700"}`}>{icon}{children}</button>; }

function LessonPanel({ article, onClose, onNavigate }: { article: LearningArticle; onClose: () => void; onNavigate: (page: string) => void }) { return <div className="fixed inset-0 z-[110] flex justify-end bg-slate-950/30" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><aside className="h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-2xl"><button onClick={onClose} className="float-right text-sm text-slate-500">Close</button><p className="text-xs font-semibold uppercase tracking-wide text-brand-700">{article.module_key} lesson</p><h2 className="mt-2 text-2xl font-bold">{article.title}</h2><p className="mt-2 text-slate-600">{article.short_description}</p>{article.media_url && <div className="mt-5 overflow-hidden rounded-xl border"><div className="flex items-center gap-2 bg-slate-50 p-3 text-sm font-medium"><Film className="h-4 w-4"/> Short demonstration</div>{article.media_type === "mp4" ? <video src={article.media_url} controls className="w-full"/> : <img src={article.media_url} alt={`${article.title} demonstration`} className="w-full"/>}</div>}<LessonList icon={<BookOpen className="h-5 w-5"/>} title="Steps" items={article.instructions}/><LessonList icon={<AlertTriangle className="h-5 w-5 text-amber-600"/>} title="Common mistakes" items={article.common_mistakes}/><LessonList icon={<Wrench className="h-5 w-5 text-blue-600"/>} title="Troubleshooting" items={article.troubleshooting}/><button className="app-btn-primary mt-6 w-full justify-center" onClick={() => { onNavigate(article.page_key); onClose(); }}>Open this BOAT page <ChevronRight className="h-4 w-4"/></button></aside></div>; }

function LessonList({ icon, title, items }: { icon: ReactNode; title: string; items: string[] }) { if (!items?.length) return null; return <section className="mt-6"><h3 className="flex items-center gap-2 font-semibold">{icon}{title}</h3><ol className="mt-3 space-y-2">{items.map((x, i) => <li key={`${title}-${i}`} className="flex gap-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"/>{x}</li>)}</ol></section>; }

function AcademyCoursePanel({ assignment, onClose, onComplete, onAssessment }: { assignment: AcademyAssignment; onClose: () => void; onComplete: () => void; onAssessment: (id: string) => void }) {
  const { user } = useAuth();
  const [saving, setSaving] = useState<string | null>(null);
  const lessons = [...(assignment.academy_course_versions?.academy_course_lessons ?? [])].sort((a, b) => a.lesson_order - b.lesson_order);
  const complete = async (lessonId: string) => {
    if (!user?.organization_id) return;
    setSaving(lessonId);
    const { error } = await (supabase as any).rpc("complete_academy_lesson", { p_organization_id: user.organization_id, p_lesson_version_id: lessonId });
    setSaving(null);
    if (!error) onComplete();
  };
  const assessment = assignment.academy_course_versions?.academy_assessments?.[0];
  return <div className="fixed inset-0 z-[110] flex justify-end bg-slate-950/30" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><aside className="h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-2xl"><button onClick={onClose} className="float-right text-sm text-slate-500">Close</button><p className="text-xs font-semibold uppercase tracking-wide text-brand-700">BOAT Academy course</p><h2 className="mt-2 text-2xl font-bold">{assignment.academy_course_versions?.title ?? "Assigned training"}</h2><p className="mt-2 text-slate-600">{assignment.academy_course_versions?.summary}</p>{lessons.length ? <div className="mt-6 space-y-5">{lessons.map((courseLesson, index) => { const lesson = courseLesson.academy_lesson_versions; if (!lesson) return null; return <article key={lesson.id} className="rounded-xl border p-4"><p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Lesson {index + 1}{courseLesson.is_required ? " · Required" : ""}</p><h3 className="mt-1 font-bold">{lesson.title}</h3><p className="mt-1 text-sm text-slate-600">{lesson.summary}</p><div className="mt-4 space-y-3">{(Array.isArray(lesson.content) ? lesson.content : []).map((block, blockIndex) => block.type === "image" || block.type === "video" ? <div key={blockIndex} className="overflow-hidden rounded-lg border">{block.type === "video" ? <video src={block.url} controls className="w-full"/> : <img src={block.url} alt="Lesson visual" className="w-full"/>}</div> : <p key={blockIndex} className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{block.text}</p>)}</div><button className="app-btn-primary mt-4" disabled={saving === lesson.id} onClick={() => void complete(lesson.id)}>{saving === lesson.id ? "Saving…" : "Mark lesson complete"}</button></article>; })}</div> : <p className="mt-6 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">This course is being prepared. Please return shortly.</p>}{assessment && <section className="mt-6 rounded-xl border border-violet-200 bg-violet-50 p-4"><h3 className="font-bold text-violet-950">{assessment.title}</h3><p className="mt-1 text-sm text-violet-800">Complete this short knowledge check to record your assessment result.</p><button className="app-btn-primary mt-3" onClick={() => onAssessment(assessment.id)}>Start assessment</button></section>}</aside></div>;
}

function AcademyAssessmentPanel({ assessmentId, onClose, onComplete }: { assessmentId: string; onClose: () => void; onComplete: () => void }) {
  const { user } = useAuth();
  const [assessment, setAssessment] = useState<{ title: string; pass_mark: number; questions: { id: string; prompt: string; options: { key: string; label: string }[] }[] } | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<string>("");
  useEffect(() => { void (async () => { const { data, error } = await (supabase as any).rpc("get_academy_assessment", { p_assessment_id: assessmentId }); if (error) setResult(error.message); else setAssessment(data); })(); }, [assessmentId]);
  const submit = async () => { if (!user?.organization_id) return; const { data, error } = await (supabase as any).rpc("submit_academy_assessment", { p_organization_id: user.organization_id, p_assessment_id: assessmentId, p_answers: answers }); if (error) setResult(error.message); else { setResult(`Score: ${data.score}%. ${data.passed ? "Passed — certificate issued." : "Not yet passed. Review the lesson and try again."}`); onComplete(); } };
  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/40 p-4"><section className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"><button onClick={onClose} className="float-right text-sm text-slate-500">Close</button><p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Knowledge check</p><h2 className="mt-2 text-2xl font-bold">{assessment?.title ?? "Loading assessment…"}</h2>{assessment && <><p className="mt-1 text-sm text-slate-600">Pass mark: {assessment.pass_mark}%</p><div className="mt-6 space-y-5">{assessment.questions.map((question, index) => <fieldset key={question.id} className="rounded-xl border p-4"><legend className="font-semibold">{index + 1}. {question.prompt}</legend><div className="mt-3 space-y-2">{question.options.map(option => <label key={option.key} className="flex cursor-pointer items-center gap-2 text-sm"><input type="radio" name={question.id} checked={answers[question.id] === option.key} onChange={() => setAnswers({...answers,[question.id]:option.key})}/>{option.label}</label>)}</div></fieldset>)}</div><button className="app-btn-primary mt-6" disabled={Object.keys(answers).length < assessment.questions.length} onClick={() => void submit()}>Submit assessment</button></>}{result && <p className="mt-4 rounded-lg bg-slate-100 p-3 text-sm">{result}</p>}</section></div>;
}

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
