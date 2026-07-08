import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Circle,
  Loader2,
  Map,
  MessageSquareText,
  Navigation,
  Send,
  X,
} from "lucide-react";

import { useAuth, type BusinessType } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  answerAssistantPrompt,
  guidanceForPage,
  guidedTourSteps,
  type AssistantResult,
} from "@/lib/userGuidance";

type OnboardingStateRow = {
  organization_id: string;
  completed_steps: string[] | null;
};

type GuideTab = "assistant" | "tour" | "learn";

type WorkspaceGuideProps = {
  currentPage: string;
  businessType: BusinessType | null | undefined;
  onNavigate: (page: string, state?: Record<string, unknown>) => void;
};

export function WorkspaceGuide({ currentPage, businessType, onNavigate }: WorkspaceGuideProps) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<GuideTab>("assistant");
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState<AssistantResult | null>(null);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [completedTours, setCompletedTours] = useState<string[]>([]);
  const [savingStep, setSavingStep] = useState<string | null>(null);

  const tourSteps = useMemo(() => guidedTourSteps(businessType), [businessType]);
  const pageGuide = useMemo(() => guidanceForPage(currentPage, businessType), [currentPage, businessType]);
  const tourDoneCount = tourSteps.filter((step) => completedSteps.includes(step.id) || completedTours.includes(step.id)).length;

  useEffect(() => {
    if (!orgId || user?.isSuperAdmin || user?.isSaccoMember) return;
    let cancelled = false;
    const load = async () => {
      const [{ data: onboarding }, { data: guidance }] = await Promise.all([
        supabase.from("organization_onboarding_state").select("organization_id,completed_steps").eq("organization_id", orgId).maybeSingle(),
        supabase.from("organization_guidance_state").select("completed_tours").eq("organization_id", orgId).maybeSingle(),
      ]);
      if (cancelled) return;
      setCompletedSteps(((onboarding as OnboardingStateRow | null)?.completed_steps ?? []) as string[]);
      setCompletedTours(((guidance as { completed_tours: string[] | null } | null)?.completed_tours ?? []) as string[]);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [orgId, user?.isSaccoMember, user?.isSuperAdmin]);

  if (!orgId || user?.isSuperAdmin || user?.isSaccoMember) return null;

  const updateCompleted = async (stepId: string) => {
    if (!orgId) return;
    setSavingStep(stepId);
    const nextSteps = Array.from(new Set([...completedSteps, stepId]));
    const { data } = await supabase.rpc("update_organization_onboarding_state", {
      p_organization_id: orgId,
      p_completed_steps: nextSteps,
      p_dismissed: null,
    });
    await supabase.rpc("update_organization_guidance_state", {
      p_organization_id: orgId,
      p_active_tour: "first_transaction",
      p_completed_tours: [stepId],
      p_dismissed_topics: null,
      p_assistant_history: null,
    });
    setCompletedSteps(((data as OnboardingStateRow | null)?.completed_steps ?? nextSteps) as string[]);
    setCompletedTours((prev) => Array.from(new Set([...prev, stepId])));
    setSavingStep(null);
  };

  const askAssistant = async () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    const result = answerAssistantPrompt(trimmed, businessType);
    setAnswer(result);
    setPrompt("");
    await supabase.rpc("update_organization_guidance_state", {
      p_organization_id: orgId,
      p_active_tour: "first_transaction",
      p_completed_tours: null,
      p_dismissed_topics: null,
      p_assistant_history: [{ at: new Date().toISOString(), prompt: trimmed, result: result.title }],
    });
  };

  const openResultPage = (page: string, checklistStep?: string) => {
    onNavigate(page);
    if (checklistStep) {
      void updateCompleted(checklistStep);
    }
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-50 inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
        aria-label="Open BOAT assistant"
        title="BOAT assistant"
      >
        <Bot className="h-5 w-5" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-end bg-slate-950/20 p-3 sm:p-5">
          <section className="flex max-h-[min(760px,calc(100vh-24px))] w-full max-w-md flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900">BOAT Assistant</p>
                <p className="text-xs text-slate-500">{tourDoneCount} of {tourSteps.length} tour steps complete</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                aria-label="Close assistant"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="grid grid-cols-3 border-b border-slate-200 bg-slate-50 p-1">
              {[
                { id: "assistant" as const, label: "Ask", icon: MessageSquareText },
                { id: "tour" as const, label: "Tour", icon: Map },
                { id: "learn" as const, label: "Learn", icon: BookOpen },
              ].map((item) => {
                const Icon = item.icon;
                const active = tab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTab(item.id)}
                    className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-md text-sm font-semibold transition ${
                      active ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </button>
                );
              })}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {tab === "assistant" ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-sm font-semibold text-slate-900">What do you want to do?</p>
                    <p className="mt-1 text-sm leading-5 text-slate-600">
                      Try: buy sugar, import opening balances, allocate rent, create a customer, record a sale, or view profit.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void askAssistant();
                      }}
                      placeholder="Ask BOAT..."
                      className="min-h-10 min-w-0 flex-1 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    />
                    <button
                      type="button"
                      onClick={() => void askAssistant()}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-slate-900 text-white hover:bg-slate-800"
                      aria-label="Send"
                      title="Send"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </div>

                  {answer ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                      <p className="text-sm font-bold text-emerald-950">{answer.title}</p>
                      <p className="mt-1 text-sm leading-5 text-emerald-800">{answer.message}</p>
                      {answer.page ? (
                        <button
                          type="button"
                          onClick={() => openResultPage(answer.page!, answer.checklistStep)}
                          className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-800"
                        >
                          <Navigation className="h-4 w-4" />
                          Open page
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {tab === "tour" ? (
                <div className="space-y-3">
                  {tourSteps.map((step) => {
                    const done = completedSteps.includes(step.id) || completedTours.includes(step.id);
                    return (
                      <div key={step.id} className="rounded-lg border border-slate-200 p-3">
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            onClick={() => void updateCompleted(step.id)}
                            className={`mt-0.5 rounded-full ${done ? "text-emerald-600" : "text-slate-300 hover:text-emerald-500"}`}
                            aria-label={done ? `${step.title} complete` : `Mark ${step.title} complete`}
                          >
                            {savingStep === step.id ? (
                              <Loader2 className="h-5 w-5 animate-spin" />
                            ) : done ? (
                              <CheckCircle2 className="h-5 w-5" />
                            ) : (
                              <Circle className="h-5 w-5" />
                            )}
                          </button>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-slate-900">{step.title}</p>
                            <p className="mt-1 text-sm leading-5 text-slate-600">{step.note}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            onNavigate(step.page);
                            setOpen(false);
                          }}
                          className="mt-3 inline-flex min-h-9 items-center gap-1 rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Open <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {tab === "learn" ? (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-bold text-slate-900">{pageGuide.title}</p>
                    <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{pageGuide.duration} guide</p>
                    <p className="mt-2 text-sm leading-5 text-slate-600">{pageGuide.summary}</p>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">Steps</p>
                    <ol className="mt-2 space-y-2">
                      {pageGuide.steps.map((step, index) => (
                        <li key={step} className="flex gap-2 text-sm leading-5 text-slate-600">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                            {index + 1}
                          </span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">FAQ</p>
                    <div className="mt-2 space-y-2">
                      {pageGuide.faqs.map((faq) => (
                        <div key={faq.question} className="rounded-lg border border-slate-200 p-3">
                          <p className="text-sm font-semibold text-slate-900">{faq.question}</p>
                          <p className="mt-1 text-sm leading-5 text-slate-600">{faq.answer}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

