import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  BookOpen,
  AlertTriangle,
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
  prepareAssistantSuggestion,
  guidanceForPage,
  guidedTourSteps,
  type AssistantSuggestion,
} from "@/lib/userGuidance";
import type { LearningArticle } from "@/components/learning/InAppLearning";
import {
  createAssistantSuggestion,
  decideAssistantSuggestion,
  loadAssistantAttention,
  loadAssistantPolicy,
  requiresAssistantApproval,
} from "@/lib/boatAssistantService";
import { loadLiveActionItems, type LiveActionItem } from "@/lib/boatAssistantActionCentre";
import { inspectAssistantDocument, type AssistantDocumentResult } from "@/lib/boatAssistantDocuments";
import { loadAssistantInsights, type AssistantInsight } from "@/lib/boatAssistantInsights";
import { proposeAssistantConfiguration, saveAssistantOnboarding, type AssistantOnboardingAnswers } from "@/lib/boatAssistantOnboarding";
import {
  deleteAssistantAutomationRule,
  loadAssistantAutomationRules,
  saveAssistantAutomationRule,
  setAssistantAutomaticEnabled,
  type AssistantAutomationRule,
} from "@/lib/boatAssistantAutomation";

type OnboardingStateRow = {
  organization_id: string;
  completed_steps: string[] | null;
};

type GuideTab = "assistant" | "tour" | "learn";
type AssistanceMode = "manual" | "guided" | "assisted" | "automatic" | "accountant_supervised";
type AssistantActivity = {
  id: string;
  at: string;
  instruction: string;
  title: string;
  status: "prepared" | "confirmed" | "accountant" | "deferred" | "rejected";
  risk: "low" | "medium" | "high";
};

const ASSISTANCE_MODES: { value: AssistanceMode; label: string; description: string }[] = [
  { value: "manual", label: "Manual", description: "Use ordinary forms and reports." },
  { value: "guided", label: "Guided", description: "Emphasise instructions, tooltips and tours." },
  { value: "assisted", label: "Assisted", description: "Prepare suggestions for your confirmation." },
  { value: "automatic", label: "Automatic", description: "Process only explicitly authorised, low-risk recurring work." },
  { value: "accountant_supervised", label: "Accountant supervised", description: "Send exceptions to an assigned accountant or manager." },
];
const EMPTY_ONBOARDING: AssistantOnboardingAnswers = { businessType: "", productsServices: "", creditSales: false, stock: false, paymentMethods: ["cash"], vatRegistered: false, employees: false, branches: false, approvals: true, assistanceMode: "guided" };
type AutomationForm = { name: string; action_type: "create_action_item" | "prepare_transaction_draft"; instruction: string; target_page: string; requires_approval: boolean; assigned_role: "admin" | "manager" | "accountant"; schedule_kind: "daily" | "weekly" | "monthly"; run_time: string; timezone: string; weekday: number; day_of_month: number; active: boolean };
const EMPTY_RULE: AutomationForm = { name: "", action_type: "create_action_item", instruction: "", target_page: "", requires_approval: false, assigned_role: "admin", schedule_kind: "daily", run_time: "08:00", timezone: "Africa/Kampala", weekday: 1, day_of_month: 1, active: true };

type WorkspaceGuideProps = {
  currentPage: string;
  businessType: BusinessType | null | undefined;
  onNavigate: (page: string, state?: Record<string, unknown>) => void;
};

export function WorkspaceGuide({ currentPage, businessType, onNavigate }: WorkspaceGuideProps) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const assistantEnabled = user?.enable_assistant === true;
  const canReviewAssistant = ["admin", "manager", "accountant"].includes(user?.role ?? "");
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<GuideTab>("assistant");
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState<AssistantSuggestion | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [actionStatus, setActionStatus] = useState<"prepared" | "confirmed" | "accountant" | "deferred" | "rejected">("prepared");
  const [activity, setActivity] = useState<AssistantActivity[]>([]);
  const [showActionCentre, setShowActionCentre] = useState(false);
  const [suggestionId, setSuggestionId] = useState<string | null>(null);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [durableAttention, setDurableAttention] = useState<Array<{ id: string; original_instruction: string; understood: string; status: string; risk: string; assigned_role: string | null; created_at: string }>>([]);
  const [liveActionItems, setLiveActionItems] = useState<LiveActionItem[]>([]);
  const [documentResult, setDocumentResult] = useState<AssistantDocumentResult | null>(null);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [insights, setInsights] = useState<AssistantInsight[]>([]);
  const [showInsights, setShowInsights] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingAnswers, setOnboardingAnswers] = useState<AssistantOnboardingAnswers>(() => ({ ...EMPTY_ONBOARDING, businessType: String(businessType ?? "") }));
  const [proposedConfiguration, setProposedConfiguration] = useState<Record<string, unknown> | null>(null);
  const [onboardingMessage, setOnboardingMessage] = useState("");
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [completedTours, setCompletedTours] = useState<string[]>([]);
  const [savingStep, setSavingStep] = useState<string | null>(null);
  const [databaseArticle, setDatabaseArticle] = useState<LearningArticle | null>(null);
  const [assistanceMode, setAssistanceMode] = useState<AssistanceMode>("guided");
  const [automationRules, setAutomationRules] = useState<AssistantAutomationRule[]>([]);
  const [automationForm, setAutomationForm] = useState(EMPTY_RULE);
  const [automationMessage, setAutomationMessage] = useState("");
  const [savingAutomation, setSavingAutomation] = useState(false);

  const tourSteps = useMemo(() => guidedTourSteps(businessType), [businessType]);
  const pageGuide = useMemo(() => {
    if (!databaseArticle) return guidanceForPage(currentPage, businessType);
    return {
      title: databaseArticle.title,
      duration: databaseArticle.media_url ? "5 min + demonstration" : "4 min",
      summary: databaseArticle.short_description,
      steps: databaseArticle.instructions ?? [],
      faqs: [
        ...(databaseArticle.common_mistakes ?? []).map((item) => ({ question: "Common mistake", answer: item })),
        ...(databaseArticle.troubleshooting ?? []).map((item) => ({ question: "Troubleshooting", answer: item })),
      ],
    };
  }, [currentPage, businessType, databaseArticle]);
  const tourDoneCount = tourSteps.filter((step) => completedSteps.includes(step.id) || completedTours.includes(step.id)).length;

  useEffect(() => {
    if (!assistantEnabled && tab === "assistant") setTab("learn");
  }, [assistantEnabled, tab]);

  useEffect(() => {
    if (!orgId) return;
    const stored = window.localStorage.getItem(`boat-assistance-mode:${orgId}`) as AssistanceMode | null;
    if (stored && ASSISTANCE_MODES.some((mode) => mode.value === stored)) setAssistanceMode(stored);
    try {
      const savedActivity = JSON.parse(window.localStorage.getItem(`boat-assistant-activity:${orgId}`) ?? "[]") as AssistantActivity[];
      setActivity(Array.isArray(savedActivity) ? savedActivity.slice(0, 25) : []);
    } catch {
      setActivity([]);
    }
  }, [orgId]);

  useEffect(() => {
    if (!orgId || !assistantEnabled) return;
    void Promise.all([loadAssistantAttention(orgId), loadLiveActionItems(orgId), loadAssistantInsights(orgId), loadAssistantAutomationRules(orgId), loadAssistantPolicy(orgId)]).then(([assistantItems, liveItems, insightItems, automation, policy]) => { setDurableAttention(assistantItems); setLiveActionItems(liveItems); setInsights(insightItems); setAutomationRules(automation.rules); if (policy.automaticEnabled) setAssistanceMode("automatic"); });
  }, [assistantEnabled, orgId]);

  const inspectDocument = async (file?: File) => {
    if (!file) return;
    setDocumentLoading(true);
    try {
      const result = await inspectAssistantDocument(file);
      setDocumentResult(result);
      setPrompt(result.suggestedInstruction);
    } catch (error) {
      setDocumentResult({ kind: "business_document", fileName: file.name, rowCount: 0, invalidCount: 0, totalValue: 0, summary: error instanceof Error ? error.message : "The document could not be read.", suggestedInstruction: `Review business document ${file.name}.` });
    } finally {
      setDocumentLoading(false);
    }
  };

  const changeAssistanceMode = async (nextMode: AssistanceMode) => {
    if (!orgId || !user?.id) return;
    if (nextMode === "automatic") {
      if (["admin", "manager"].includes(user.role ?? "")) {
        const error = await setAssistantAutomaticEnabled(orgId, user.id, true);
        if (!error) {
          setAssistanceMode("automatic");
          setAutomationMessage("Automatic mode is active. The worker checks due rules every five minutes.");
          return;
        }
        setAutomationMessage(error);
      }
      setAnswer({
        title: "Explicit authorisation required",
        message: "Automatic mode cannot activate recurring work by itself. An authorised administrator must configure the permitted rule, limits and approvals.",
        originalInstruction: "Change assistance mode to Automatic",
        understood: "Automatic processing requested",
        recommendedTreatment: "Keep the current mode until an authorised automation rule is configured.",
        amount: null,
        currency: null,
        transactionDate: new Date().toISOString().slice(0, 10),
        confidence: "high",
        risk: "high",
        needsConfirmation: true,
        explanation: "Automatic processing requires explicit authorisation and defined limits.",
        draft: { transactionType: "other", counterparty: null, description: "Change assistance mode to Automatic", quantity: null, paymentMethod: null, amount: null, currency: null, date: new Date().toISOString().slice(0, 10) },
      });
      return;
    }
    if (assistanceMode === "automatic" && ["admin", "manager"].includes(user.role ?? "")) await setAssistantAutomaticEnabled(orgId, user.id, false);
    setAssistanceMode(nextMode);
    window.localStorage.setItem(`boat-assistance-mode:${orgId}`, nextMode);
  };

  const refreshAutomationRules = async () => {
    if (!orgId) return;
    const result = await loadAssistantAutomationRules(orgId);
    setAutomationRules(result.rules);
    if (result.error) setAutomationMessage(result.error);
  };

  const createAutomationRule = async () => {
    if (!orgId || !user?.id || !automationForm.name.trim() || !automationForm.instruction.trim()) { setAutomationMessage("Rule name and instruction are required."); return; }
    setSavingAutomation(true);
    const error = await saveAssistantAutomationRule({ ...automationForm, organization_id: orgId, draft: {}, id: undefined, userId: user.id });
    setSavingAutomation(false);
    setAutomationMessage(error ?? "Automation rule saved. Activate Automatic mode when ready.");
    if (!error) { setAutomationForm(EMPTY_RULE); await refreshAutomationRules(); }
  };

  const removeAutomationRule = async (id: string) => {
    if (!orgId) return;
    const error = await deleteAssistantAutomationRule(orgId, id);
    setAutomationMessage(error ?? "Automation rule removed.");
    if (!error) await refreshAutomationRules();
  };

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

  useEffect(() => {
    if (!orgId || user?.isSuperAdmin || user?.isSaccoMember) return;
    let cancelled = false;
    const loadArticle = async () => {
      const { data } = await (supabase as any)
        .from("help_articles")
        .select("*")
        .eq("page_key", currentPage)
        .eq("is_active", true)
        .order("organization_id", { ascending: false, nullsFirst: false })
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setDatabaseArticle((data as LearningArticle | null) ?? null);
    };
    void loadArticle();
    return () => { cancelled = true; };
  }, [currentPage, orgId, user?.isSaccoMember, user?.isSuperAdmin]);

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
    const result = prepareAssistantSuggestion(trimmed, businessType);
    const policy = await loadAssistantPolicy(orgId);
    const needsApproval = requiresAssistantApproval(result, policy);
    const persisted = user?.id ? await createAssistantSuggestion({ organizationId: orgId, userId: user.id, suggestion: result, approvalRequired: needsApproval }) : { id: null, duplicate: false };
    setAnswer(result);
    setSuggestionId(persisted.id);
    setApprovalRequired(needsApproval || persisted.duplicate);
    if (persisted.duplicate) setShowExplanation(true);
    setActionStatus("prepared");
    setShowExplanation(false);
    setPrompt("");
    await supabase.rpc("update_organization_guidance_state", {
      p_organization_id: orgId,
      p_active_tour: "first_transaction",
      p_completed_tours: null,
      p_dismissed_topics: null,
      p_assistant_history: [{ at: new Date().toISOString(), prompt: trimmed, result: result.title }],
    });
  };

  const recordAssistantDecision = async (status: typeof actionStatus) => {
    if (!answer) return;
    setActionStatus(status);
    const entry: AssistantActivity = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      instruction: answer.originalInstruction,
      title: answer.title,
      status,
      risk: answer.risk,
    };
    const nextActivity = [entry, ...activity].slice(0, 25);
    setActivity(nextActivity);
    window.localStorage.setItem(`boat-assistant-activity:${orgId}`, JSON.stringify(nextActivity));
    if (suggestionId && user?.id) {
      const durableDecision = status === "accountant" ? "approval_required" : status === "confirmed" ? "confirmed" : status === "deferred" ? "deferred" : "rejected";
      await decideAssistantSuggestion({ organizationId: orgId, userId: user.id, suggestionId, decision: durableDecision, finalValues: answer.draft });
      setDurableAttention(await loadAssistantAttention(orgId));
    }
    await supabase.rpc("update_organization_guidance_state", {
      p_organization_id: orgId,
      p_active_tour: "first_transaction",
      p_completed_tours: null,
      p_dismissed_topics: null,
      p_assistant_history: [{
        at: new Date().toISOString(),
        prompt: answer.originalInstruction,
        result: answer.title,
        status,
        confidence: answer.confidence,
        risk: answer.risk,
      }],
    });
  };

  const confirmSuggestion = async () => {
    if (!answer) return;
    if (approvalRequired) {
      await recordAssistantDecision("accountant");
      return;
    }
    await recordAssistantDecision("confirmed");
    if (answer.page) openResultPage(answer.page, answer.checklistStep, answer.draft);
  };

  const reviewDurableSuggestion = async (id: string, decision: "approved" | "rejected") => {
    if (!orgId || !user?.id || !canReviewAssistant) return;
    await decideAssistantSuggestion({ organizationId: orgId, userId: user.id, suggestionId: id, decision });
    setDurableAttention(await loadAssistantAttention(orgId));
  };

  const reviewOnboardingProposal = () => {
    setProposedConfiguration(proposeAssistantConfiguration(onboardingAnswers));
    setOnboardingMessage("Review the proposed configuration below. Nothing has been activated.");
  };

  const persistOnboarding = async (activate: boolean) => {
    if (!orgId || !user?.id) return;
    const result = await saveAssistantOnboarding(orgId, user.id, onboardingAnswers, activate);
    setProposedConfiguration(result.proposed);
    setOnboardingMessage(result.error ? result.error : activate ? "Assistant configuration activated after review." : "Proposed configuration saved for review.");
  };

  const openResultPage = (page: string, checklistStep?: string, assistantDraft?: AssistantSuggestion["draft"]) => {
    onNavigate(page, assistantDraft ? { assistantDraft, assistantSuggestionId: suggestionId } : undefined);
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
        aria-label={assistantEnabled ? "Open BOAT Assistant" : "Open Help & Learning"}
        title={assistantEnabled ? "BOAT Assistant" : "Help & Learning"}
      >
        {assistantEnabled ? <Bot className="h-5 w-5" /> : <BookOpen className="h-5 w-5" />}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-end bg-slate-950/20 p-3 sm:p-5">
          <section className="flex max-h-[min(760px,calc(100vh-24px))] w-full max-w-md flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900">{assistantEnabled ? "BOAT Assistant" : "Help & Learning"}</p>
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
                { id: "learn" as const, label: "Help & Learning", icon: BookOpen },
              ].filter((item) => assistantEnabled || item.id !== "assistant").map((item) => {
                const Icon = item.icon;
                const active = tab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={item.id === "tour" && actionStatus === "prepared" && Boolean(answer)}
                    title={item.id === "tour" && actionStatus === "prepared" && Boolean(answer) ? "Finish or defer the current confirmation before starting a tour." : undefined}
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
                      BOAT Assistant helps you record transactions, check your work and understand your business. You remain in control of important decisions.
                    </p>
                  </div>
                  <div>
                    <label htmlFor="assistance-mode" className="text-xs font-bold uppercase tracking-wide text-slate-500">Assistance mode</label>
                    <select
                      id="assistance-mode"
                      value={assistanceMode}
                      onChange={(event) => void changeAssistanceMode(event.target.value as AssistanceMode)}
                      className="mt-1 min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800"
                    >
                      {ASSISTANCE_MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
                    </select>
                    <p className="mt-1 text-xs leading-4 text-slate-500">{ASSISTANCE_MODES.find((mode) => mode.value === assistanceMode)?.description}</p>
                  </div>
                  <section className="rounded-lg border border-slate-200 bg-white">
                    <button type="button" onClick={() => setShowActionCentre((value) => !value)} className="flex w-full items-center justify-between gap-3 p-3 text-left">
                      <span><span className="block text-sm font-bold text-slate-900">Action Centre</span><span className="block text-xs text-slate-500">Only items requiring attention</span></span>
                      <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">{durableAttention.length + liveActionItems.length || activity.filter((item) => item.status === "accountant" || item.status === "deferred").length}</span>
                    </button>
                    {showActionCentre ? <div className="border-t border-slate-200 p-3">
                      {liveActionItems.length ? <div className="mb-3 space-y-2">{liveActionItems.map((item) => <button key={item.id} type="button" onClick={() => { onNavigate(item.page); setOpen(false); }} className="w-full rounded-md border border-amber-200 bg-amber-50 p-2 text-left"><div className="flex justify-between gap-2"><p className="text-xs font-bold text-amber-950">{item.title}</p><span className="text-[10px] font-bold uppercase text-amber-700">{item.urgency}</span></div><p className="mt-1 text-xs text-amber-800">{item.explanation}</p><p className="mt-1 text-xs font-bold text-amber-900">Value: {item.value.toLocaleString()}</p></button>)}</div> : null}
                      {durableAttention.length ? <div className="space-y-2">{durableAttention.map((item) => <div key={item.id} className="rounded-md bg-amber-50 p-2"><div className="flex justify-between gap-2"><p className="text-xs font-bold text-amber-950">{item.understood}</p><span className="text-[10px] font-bold uppercase text-amber-700">{item.assigned_role ? `${item.assigned_role} review` : item.status}</span></div><p className="mt-1 line-clamp-2 text-xs text-amber-800">{item.original_instruction}</p>{canReviewAssistant && item.status === "approval_required" ? <div className="mt-2 flex gap-2"><button type="button" onClick={() => void reviewDurableSuggestion(item.id, "approved")} className="rounded bg-emerald-700 px-2 py-1 text-[11px] font-bold text-white">Approve</button><button type="button" onClick={() => void reviewDurableSuggestion(item.id, "rejected")} className="rounded border border-red-200 px-2 py-1 text-[11px] font-bold text-red-700">Reject</button></div> : null}</div>)}</div> : !liveActionItems.length && activity.filter((item) => item.status === "accountant" || item.status === "deferred").length ? <div className="space-y-2">{activity.filter((item) => item.status === "accountant" || item.status === "deferred").map((item) => <div key={item.id} className="rounded-md bg-amber-50 p-2"><p className="text-xs font-bold text-amber-950">{item.title}</p><p className="mt-1 line-clamp-2 text-xs text-amber-800">{item.instruction}</p></div>)}</div> : !liveActionItems.length ? <p className="text-xs text-slate-500">No assistant items currently need attention.</p> : null}
                      {activity.length ? <details className="mt-3"><summary className="cursor-pointer text-xs font-bold text-slate-700">Assistant activity log ({activity.length})</summary><div className="mt-2 space-y-1">{activity.map((item) => <div key={`log-${item.id}`} className="flex justify-between gap-2 border-t border-slate-100 py-2 text-xs"><span className="text-slate-700">{item.title}</span><span className="font-semibold uppercase text-slate-500">{item.status}</span></div>)}</div></details> : null}
                    </div> : null}
                  </section>
                  <section className="rounded-lg border border-slate-200 bg-white">
                    <button type="button" onClick={() => setShowInsights((value) => !value)} className="flex w-full items-center justify-between p-3 text-left"><span><span className="block text-sm font-bold text-slate-900">Business insights</span><span className="block text-xs text-slate-500">Facts linked to supporting records</span></span><span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-bold text-blue-800">{insights.length}</span></button>
                    {showInsights ? <div className="space-y-2 border-t border-slate-200 p-3">{insights.length ? insights.map((insight) => <div key={insight.id} className={`rounded-md border p-3 ${insight.severity === "warning" ? "border-amber-200 bg-amber-50" : insight.severity === "positive" ? "border-emerald-200 bg-emerald-50" : "border-blue-200 bg-blue-50"}`}><p className="text-sm font-bold text-slate-900">{insight.fact}</p><p className="mt-1 text-xs text-slate-700"><strong>Recommended:</strong> {insight.recommendation}</p><button type="button" onClick={() => { onNavigate(insight.page); setOpen(false); }} className="mt-2 text-xs font-bold text-blue-700">View supporting records · {insight.sourceLabel}</button></div>) : <p className="text-xs text-slate-500">Not enough comparable records are available yet.</p>}</div> : null}
                  </section>
                  <section className="rounded-lg border border-slate-200 bg-white">
                    <button type="button" onClick={() => setShowOnboarding((value) => !value)} className="w-full p-3 text-left"><span className="block text-sm font-bold text-slate-900">Assistant setup</span><span className="block text-xs text-slate-500">Propose workflows before activation</span></button>
                    {showOnboarding ? <div className="space-y-3 border-t border-slate-200 p-3"><input value={onboardingAnswers.productsServices} onChange={(event) => setOnboardingAnswers((value) => ({ ...value, productsServices: event.target.value }))} placeholder="Products and services" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" /><div className="grid grid-cols-2 gap-2 text-xs">{[["creditSales", "Credit sales"], ["stock", "Keep stock"], ["vatRegistered", "VAT registered"], ["employees", "Employees"], ["branches", "Branches"], ["approvals", "Require approvals"]].map(([key, label]) => <label key={key} className="flex items-center gap-2 rounded border border-slate-200 p-2"><input type="checkbox" checked={Boolean(onboardingAnswers[key as keyof AssistantOnboardingAnswers])} onChange={(event) => setOnboardingAnswers((value) => ({ ...value, [key]: event.target.checked }))} />{label}</label>)}</div><div><p className="text-xs font-bold text-slate-600">Payment methods</p><div className="mt-1 flex flex-wrap gap-2">{["cash", "mobile_money", "bank", "wallet"].map((method) => <label key={method} className="text-xs"><input type="checkbox" className="mr-1" checked={onboardingAnswers.paymentMethods.includes(method)} onChange={(event) => setOnboardingAnswers((value) => ({ ...value, paymentMethods: event.target.checked ? Array.from(new Set([...value.paymentMethods, method])) : value.paymentMethods.filter((item) => item !== method) }))} />{method.replace(/_/g, " ")}</label>)}</div></div><button type="button" onClick={reviewOnboardingProposal} className="rounded-md bg-slate-900 px-3 py-2 text-xs font-bold text-white">Review proposed configuration</button>{proposedConfiguration ? <div className="rounded-md bg-slate-50 p-3"><pre className="whitespace-pre-wrap text-[11px] text-slate-700">{JSON.stringify(proposedConfiguration, null, 2)}</pre><div className="mt-2 flex gap-2"><button type="button" onClick={() => void persistOnboarding(false)} className="rounded border border-slate-300 px-2 py-1 text-xs font-bold">Save proposal</button>{["admin", "manager"].includes(user?.role ?? "") ? <button type="button" onClick={() => void persistOnboarding(true)} className="rounded bg-emerald-700 px-2 py-1 text-xs font-bold text-white">Activate after review</button> : null}</div></div> : null}{onboardingMessage ? <p className="text-xs font-semibold text-slate-600">{onboardingMessage}</p> : null}</div> : null}
                  </section>
                  {canReviewAssistant ? <section className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-sm font-bold text-slate-900">Automatic rules</p>
                    <p className="mt-1 text-xs text-slate-500">The worker creates action items or approval-controlled drafts. It never posts directly to the ledger.</p>
                    <div className="mt-3 space-y-2">
                      <input value={automationForm.name} onChange={(event) => setAutomationForm((value) => ({ ...value, name: event.target.value }))} placeholder="Rule name" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                      <textarea value={automationForm.instruction} onChange={(event) => setAutomationForm((value) => ({ ...value, instruction: event.target.value }))} placeholder="Recurring instruction" className="min-h-20 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                      <div className="grid grid-cols-2 gap-2">
                        <select value={automationForm.action_type} onChange={(event) => setAutomationForm((value) => ({ ...value, action_type: event.target.value as typeof value.action_type, requires_approval: event.target.value === "prepare_transaction_draft" ? true : value.requires_approval }))} className="rounded-md border border-slate-300 px-2 py-2 text-xs"><option value="create_action_item">Create action item</option><option value="prepare_transaction_draft">Prepare transaction draft</option></select>
                        <select value={automationForm.schedule_kind} onChange={(event) => setAutomationForm((value) => ({ ...value, schedule_kind: event.target.value as typeof value.schedule_kind }))} className="rounded-md border border-slate-300 px-2 py-2 text-xs"><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select>
                        <input type="time" value={automationForm.run_time} onChange={(event) => setAutomationForm((value) => ({ ...value, run_time: event.target.value }))} className="rounded-md border border-slate-300 px-2 py-2 text-xs" />
                        <select value={automationForm.assigned_role} onChange={(event) => setAutomationForm((value) => ({ ...value, assigned_role: event.target.value as typeof value.assigned_role }))} className="rounded-md border border-slate-300 px-2 py-2 text-xs"><option value="admin">Administrator</option><option value="manager">Manager</option><option value="accountant">Accountant</option></select>
                      </div>
                      {automationForm.schedule_kind === "weekly" ? <select value={automationForm.weekday} onChange={(event) => setAutomationForm((value) => ({ ...value, weekday: Number(event.target.value) }))} className="w-full rounded-md border border-slate-300 px-2 py-2 text-xs">{["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map((day,index) => <option key={day} value={index}>{day}</option>)}</select> : null}
                      {automationForm.schedule_kind === "monthly" ? <input type="number" min="1" max="28" value={automationForm.day_of_month} onChange={(event) => setAutomationForm((value) => ({ ...value, day_of_month: Number(event.target.value) }))} className="w-full rounded-md border border-slate-300 px-2 py-2 text-xs" aria-label="Day of month" /> : null}
                      <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={automationForm.requires_approval} disabled={automationForm.action_type === "prepare_transaction_draft"} onChange={(event) => setAutomationForm((value) => ({ ...value, requires_approval: event.target.checked }))} />Require approval</label>
                      <button type="button" disabled={savingAutomation} onClick={() => void createAutomationRule()} className="rounded-md bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{savingAutomation ? "Saving..." : "Save active rule"}</button>
                    </div>
                    {automationRules.length ? <div className="mt-3 space-y-2">{automationRules.map((rule) => <div key={rule.id} className="rounded-md bg-slate-50 p-2"><div className="flex items-start justify-between gap-2"><div><p className="text-xs font-bold text-slate-900">{rule.name}</p><p className="text-[11px] text-slate-500">{rule.schedule_kind} at {rule.run_time.slice(0,5)} · {rule.requires_approval ? "approval required" : "authorised action"}</p></div><button type="button" onClick={() => void removeAutomationRule(rule.id)} className="text-[11px] font-bold text-red-700">Remove</button></div></div>)}</div> : null}
                    {automationMessage ? <p className="mt-2 text-xs font-semibold text-slate-600">{automationMessage}</p> : null}
                  </section> : null}
                  <div className="grid grid-cols-2 gap-2">
                    {["I made a sale", "I received money", "I bought stock", "I paid an expense", "I bought equipment", "Check my profit"].map((action) => (
                      <button key={action} type="button" onClick={() => setPrompt(action)} className="rounded-md border border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50">{action}</button>
                    ))}
                  </div>
                  <label className="block cursor-pointer rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-center text-xs font-semibold text-slate-700 hover:bg-slate-100">
                    {documentLoading ? "Reading document..." : "Upload bank, mobile-money or business document"}
                    <input type="file" accept=".pdf,.csv,.xlsx,.xls,.txt,application/pdf" className="hidden" disabled={documentLoading} onChange={(event) => { void inspectDocument(event.target.files?.[0]); event.currentTarget.value = ""; }} />
                  </label>
                  {documentResult ? <div className="rounded-lg border border-blue-200 bg-blue-50 p-3"><p className="text-xs font-bold uppercase text-blue-700">Automatic document check</p><p className="mt-1 text-sm font-semibold text-blue-950">{documentResult.fileName}</p><p className="mt-1 text-xs leading-5 text-blue-800">{documentResult.summary}</p></div> : null}
                  <div className="flex gap-2">
                    <input
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void askAssistant();
                      }}
                      placeholder="Describe what happened in plain language..."
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
                      <div className="flex items-start justify-between gap-3">
                        <div><p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Prepared for review</p><p className="mt-1 text-sm font-bold text-emerald-950">{answer.title}</p></div>
                        <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${answer.risk === "high" ? "bg-red-100 text-red-700" : answer.risk === "medium" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{answer.risk} risk</span>
                      </div>
                      <dl className="mt-3 space-y-2 text-sm">
                        <div><dt className="font-semibold text-emerald-950">What BOAT understood</dt><dd className="text-emerald-800">{answer.understood}</dd></div>
                        <div><dt className="font-semibold text-emerald-950">Recommended treatment</dt><dd className="text-emerald-800">{answer.recommendedTreatment}</dd></div>
                        <div className="grid grid-cols-2 gap-2"><div><dt className="font-semibold text-emerald-950">Amount</dt><dd className="text-emerald-800">{answer.amount === null ? "Not provided" : `${answer.currency ?? ""} ${answer.amount.toLocaleString()}`}</dd></div><div><dt className="font-semibold text-emerald-950">Date</dt><dd className="text-emerald-800">{answer.transactionDate}</dd></div></div>
                      </dl>
                      <div className="mt-3 flex items-center gap-2 rounded-md bg-white/70 p-2 text-xs text-emerald-900"><AlertTriangle className="h-4 w-4 shrink-0"/><span>Nothing has been posted. Confidence: <strong>{answer.confidence}</strong>.</span></div>
                      {showExplanation ? <p className="mt-2 rounded-md border border-emerald-200 bg-white p-2 text-xs leading-4 text-emerald-800">{answer.explanation}</p> : null}
                      {actionStatus === "prepared" ? <div className="mt-3 flex flex-wrap gap-2">
                        {answer.page ? (
                        <button
                          type="button"
                          onClick={() => void confirmSuggestion()}
                          className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-800"
                        >
                          <Navigation className="h-4 w-4" />
                          {approvalRequired ? "Send for approval" : "Confirm & open"}
                        </button>
                      ) : null}
                        <button type="button" onClick={() => setPrompt(answer.originalInstruction)} className="mt-3 rounded-md border border-emerald-300 px-3 text-xs font-semibold text-emerald-800">Edit</button>
                        <button type="button" onClick={() => void recordAssistantDecision("accountant")} className="mt-3 rounded-md border border-emerald-300 px-3 text-xs font-semibold text-emerald-800">Ask Accountant</button>
                        <button type="button" onClick={() => void recordAssistantDecision("deferred")} className="mt-3 rounded-md border border-emerald-300 px-3 text-xs font-semibold text-emerald-800">Not Now</button>
                        <button type="button" onClick={() => void recordAssistantDecision("rejected")} className="mt-3 rounded-md border border-red-200 px-3 text-xs font-semibold text-red-700">Reject</button>
                        <button type="button" onClick={() => setShowExplanation((value) => !value)} className="mt-3 rounded-md px-2 text-xs font-semibold text-emerald-800">Why this suggestion?</button>
                        <button type="button" onClick={() => setTab("learn")} className="mt-3 rounded-md px-2 text-xs font-semibold text-emerald-800">Learn why / Show me how</button>
                      </div> : <p className="mt-3 text-xs font-bold uppercase tracking-wide text-emerald-800">Status: {actionStatus.replace("_", " ")}</p>}
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
                  {assistantEnabled ? <button type="button" onClick={() => { setPrompt(`Help me complete: ${pageGuide.title}`); setTab("assistant"); }} className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-bold text-white">Let BOAT help me do this</button> : null}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
