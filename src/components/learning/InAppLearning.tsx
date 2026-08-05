import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BookOpen, CheckCircle2, ChevronLeft, ChevronRight, HelpCircle, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

export type LearningArticle = {
  id: string;
  page_key: string;
  module_key: string;
  role_keys: string[];
  title: string;
  short_description: string;
  instructions: string[];
  common_mistakes: string[];
  related_guidance: string[];
  troubleshooting: string[];
  media_url: string | null;
  media_type: "gif" | "mp4" | "web" | null;
};

type TourStep = { id: string; title: string; body: string; target_selector: string | null };

async function saveProgress(orgId: string, userId: string, type: string, key: string, status: string, progress: Record<string, unknown> = {}) {
  await (supabase as any).from("user_training_progress").upsert({
    organization_id: orgId,
    user_id: userId,
    content_type: type,
    content_key: key,
    status,
    progress,
    completed_at: status === "completed" ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "organization_id,user_id,content_type,content_key" });
}

export function HelpTooltip({ term, children }: { term: string; children: ReactNode }) {
  return <span className="group relative inline-flex items-center gap-1"><span>{term}</span><button type="button" aria-label={`Explain ${term}`} className="text-brand-700"><HelpCircle className="h-4 w-4" /></button><span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden w-64 -translate-x-1/2 rounded-lg bg-slate-900 p-3 text-xs font-normal text-white shadow-xl group-hover:block group-focus-within:block">{children}</span></span>;
}

export function PageIntroduction({ pageKey, title, children }: { pageKey: string; title: string; children: ReactNode }) {
  const { user } = useAuth();
  const storageKey = `boat.learning.introduction.${user?.id ?? "guest"}.${pageKey}`;
  const [visible, setVisible] = useState(() => typeof window === "undefined" || localStorage.getItem(storageKey) !== "dismissed");
  if (!visible) return null;
  const dismiss = () => {
    localStorage.setItem(storageKey, "dismissed");
    setVisible(false);
    if (user?.organization_id && user.id) void saveProgress(user.organization_id, user.id, "introduction", pageKey, "dismissed");
  };
  return <section className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950"><div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2 font-semibold"><BookOpen className="h-4 w-4" />{title}</div><div className="mt-1 text-blue-900">{children}</div></div><button type="button" onClick={dismiss} className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium hover:bg-blue-100">Don't show again</button></div></section>;
}

export function TrainingProgress({ completed, total }: { completed: number; total: number }) {
  const pct = total ? Math.round((completed / total) * 100) : 0;
  return <div aria-label={`${pct}% training complete`}><div className="mb-1 flex justify-between text-xs text-slate-600"><span>Learning progress</span><span>{completed}/{total} complete</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} /></div></div>;
}

export function GuidedTour({ tourKey, title, steps, onClose }: { tourKey: string; title: string; steps: TourStep[]; onClose: () => void }) {
  const { user } = useAuth();
  const [index, setIndex] = useState(0);
  const step = steps[index];
  useEffect(() => {
    if (!step?.target_selector) return;
    const target = document.querySelector(step.target_selector);
    target?.classList.add("ring-4", "ring-brand-300", "ring-offset-2");
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    return () => target?.classList.remove("ring-4", "ring-brand-300", "ring-offset-2");
  }, [step]);
  const finish = (status: "completed" | "dismissed") => {
    if (user?.organization_id && user.id) void saveProgress(user.organization_id, user.id, "tour", tourKey, status, { last_step: index + 1, total_steps: steps.length });
    onClose();
  };
  if (!step) return null;
  return <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/30 p-4 sm:items-center"><section role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Step {index + 1} of {steps.length}</p><h2 className="mt-1 text-xl font-bold text-slate-900">{step.title}</h2></div><button onClick={() => finish("dismissed")} aria-label="Skip tour"><X className="h-5 w-5" /></button></div><p className="mt-3 text-sm text-slate-600">{step.body}</p><div className="mt-5 flex items-center justify-between"><button className="app-btn-secondary" disabled={index === 0} onClick={() => setIndex(i => i - 1)}><ChevronLeft className="h-4 w-4" /> Back</button>{index === steps.length - 1 ? <button className="app-btn-primary" onClick={() => finish("completed")}><CheckCircle2 className="h-4 w-4" /> Finish</button> : <button className="app-btn-primary" onClick={() => setIndex(i => i + 1)}>Next <ChevronRight className="h-4 w-4" /></button>}</div></section></div>;
}

export function useRoleVisibleArticles(articles: LearningArticle[]) {
  const { user } = useAuth();
  const role = String(user?.role ?? "").toLowerCase();
  return useMemo(() => articles.filter(a => !a.role_keys?.length || a.role_keys.map(x => x.toLowerCase()).includes(role)), [articles, role]);
}
