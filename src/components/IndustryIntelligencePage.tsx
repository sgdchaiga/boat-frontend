import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Lightbulb,
  Loader2,
  RefreshCcw,
  Sparkles,
  Target,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";
import { supabase } from "@/lib/supabase";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";
import {
  buildBusinessRecommendations,
  getIndustryPlaybook,
  type BusinessRecommendation,
  type IntelligenceMetrics,
} from "@/lib/industryIntelligence";

type IntelligenceStateRow = {
  completed_recommendations: string[] | null;
  dismissed_recommendations: string[] | null;
  last_reviewed_at: string | null;
};

const emptyMetrics: IntelligenceMetrics = {
  completedSteps: [],
  productsCount: 0,
  glAccountsCount: 0,
  departmentsCount: 0,
  payments30dCount: 0,
  journalsCount: 0,
  stockMovementsCount: 0,
  migrationBatchesCount: 0,
  costAllocationRunsCount: 0,
};

function priorityClass(priority: BusinessRecommendation["priority"]) {
  if (priority === "high") return "border-rose-200 bg-rose-50 text-rose-800";
  if (priority === "medium") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-sky-200 bg-sky-50 text-sky-800";
}

function formatReviewed(value: string | null) {
  if (!value) return "Not reviewed yet";
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function IndustryIntelligencePage({ onNavigate }: { onNavigate: (page: string, state?: Record<string, unknown>) => void }) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const businessType = user?.business_type ?? null;
  const superAdmin = !!user?.isSuperAdmin;
  const playbook = useMemo(() => getIndustryPlaybook(businessType), [businessType]);

  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<IntelligenceMetrics>(emptyMetrics);
  const [stateRow, setStateRow] = useState<IntelligenceStateRow>({
    completed_recommendations: [],
    dismissed_recommendations: [],
    last_reviewed_at: null,
  });

  const load = async () => {
    if (!orgId) return;
    setLoading(true);
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const [
      onboardingRes,
      intelligenceRes,
      productsRes,
      glRes,
      departmentsRes,
      paymentsRes,
      journalsRes,
      stockRes,
      migrationRes,
      allocationRes,
    ] = await Promise.all([
      supabase.from("organization_onboarding_state").select("completed_steps").eq("organization_id", orgId).maybeSingle(),
      supabase.from("organization_industry_intelligence_state").select("completed_recommendations,dismissed_recommendations,last_reviewed_at").eq("organization_id", orgId).maybeSingle(),
      filterByOrganizationId(supabase.from("products").select("id", { count: "exact", head: true }), orgId, superAdmin),
      filterByOrganizationId(supabase.from("gl_accounts").select("id", { count: "exact", head: true }), orgId, superAdmin),
      filterByOrganizationId(supabase.from("departments").select("id", { count: "exact", head: true }), orgId, superAdmin),
      filterByOrganizationId(
        supabase.from("payments").select("id", { count: "exact", head: true }).gte("paid_at", since.toISOString()),
        orgId,
        superAdmin
      ),
      filterByOrganizationId(supabase.from("journal_entries").select("id", { count: "exact", head: true }), orgId, superAdmin),
      filterByOrganizationId(supabase.from("product_stock_movements").select("id", { count: "exact", head: true }), orgId, superAdmin),
      supabase.from("data_migration_batches").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
      supabase.from("cost_allocation_runs").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
    ]);

    setMetrics({
      completedSteps: ((onboardingRes.data as { completed_steps?: string[] | null } | null)?.completed_steps ?? []) as string[],
      productsCount: productsRes.count ?? 0,
      glAccountsCount: glRes.count ?? 0,
      departmentsCount: departmentsRes.count ?? 0,
      payments30dCount: paymentsRes.count ?? 0,
      journalsCount: journalsRes.count ?? 0,
      stockMovementsCount: stockRes.count ?? 0,
      migrationBatchesCount: migrationRes.count ?? 0,
      costAllocationRunsCount: allocationRes.count ?? 0,
    });
    setStateRow(
      (intelligenceRes.data as IntelligenceStateRow | null) ?? {
        completed_recommendations: [],
        dismissed_recommendations: [],
        last_reviewed_at: null,
      }
    );
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [orgId, superAdmin]);

  const completed = new Set(stateRow.completed_recommendations ?? []);
  const dismissed = new Set(stateRow.dismissed_recommendations ?? []);
  const recommendations = useMemo(
    () => buildBusinessRecommendations(businessType, metrics).filter((rec) => !dismissed.has(rec.id)),
    [businessType, metrics, stateRow.dismissed_recommendations]
  );
  const openRecommendations = recommendations.filter((rec) => !completed.has(rec.id));
  const healthScore = Math.max(0, Math.round(((recommendations.length - openRecommendations.length) / Math.max(1, recommendations.length)) * 100));

  const updateState = async (id: string, mode: "complete" | "dismiss" | "review") => {
    if (!orgId) return;
    setSavingId(id);
    const { data } = await supabase.rpc("update_organization_industry_intelligence_state", {
      p_organization_id: orgId,
      p_completed_recommendations: mode === "complete" ? [id] : null,
      p_dismissed_recommendations: mode === "dismiss" ? [id] : null,
      p_mark_reviewed: mode === "review",
    });
    if (data) setStateRow(data as IntelligenceStateRow);
    setSavingId(null);
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="h-40 animate-pulse rounded-lg bg-slate-200" />
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-950">{playbook.label}</h1>
              <PageNotes variant="guide" ariaLabel="Industry intelligence notes">
                <p>
                  This page combines the selected business template, recommended workflows, expected reports, and setup signals to guide management review.
                </p>
              </PageNotes>
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{playbook.focus}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void updateState("review", "review")}
              className="inline-flex min-h-10 items-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-800"
            >
              {savingId === "review" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Mark reviewed
            </button>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase text-slate-500">Health score</p>
            <p className="mt-2 text-3xl font-bold text-slate-950">{healthScore}%</p>
            <p className="mt-1 text-sm text-slate-600">{openRecommendations.length} open recommendations</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase text-slate-500">Setup evidence</p>
            <p className="mt-2 text-3xl font-bold text-slate-950">{metrics.completedSteps.length}</p>
            <p className="mt-1 text-sm text-slate-600">completed onboarding steps</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase text-slate-500">Transactions</p>
            <p className="mt-2 text-3xl font-bold text-slate-950">{metrics.payments30dCount + metrics.journalsCount}</p>
            <p className="mt-1 text-sm text-slate-600">payments and journals tracked</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase text-slate-500">Last review</p>
            <p className="mt-2 text-sm font-bold text-slate-950">{formatReviewed(stateRow.last_reviewed_at)}</p>
            <p className="mt-1 text-sm text-slate-600">management intelligence cycle</p>
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-5">
            <div className="rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
                <Target className="h-5 w-5 text-slate-700" />
                <h2 className="text-base font-bold text-slate-950">Best-practice workflow</h2>
              </div>
              <div className="divide-y divide-slate-100">
                {playbook.workflows.map((step, index) => (
                  <div key={step.title} className="flex gap-3 p-4">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-900">{step.title}</p>
                      <p className="mt-1 text-sm leading-5 text-slate-600">{step.note}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onNavigate(step.page)}
                      className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-200 px-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Open <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
                <Lightbulb className="h-5 w-5 text-slate-700" />
                <h2 className="text-base font-bold text-slate-950">Recommendations</h2>
              </div>
              <div className="divide-y divide-slate-100">
                {recommendations.map((rec) => {
                  const done = completed.has(rec.id);
                  return (
                    <div key={rec.id} className="p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full border px-2 py-0.5 text-xs font-bold uppercase ${priorityClass(rec.priority)}`}>
                              {rec.priority}
                            </span>
                            {done ? <span className="text-xs font-semibold text-emerald-700">Completed</span> : null}
                          </div>
                          <p className="mt-2 text-sm font-bold text-slate-950">{rec.title}</p>
                          <p className="mt-1 text-sm leading-5 text-slate-600">{rec.detail}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => onNavigate(rec.page)}
                            className="inline-flex min-h-9 items-center gap-1 rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            {rec.action} <ChevronRight className="h-4 w-4" />
                          </button>
                          {!done ? (
                            <button
                              type="button"
                              onClick={() => void updateState(rec.id, "complete")}
                              className="inline-flex min-h-9 items-center gap-2 rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-800"
                            >
                              {savingId === rec.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                              Done
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => void updateState(rec.id, "dismiss")}
                            className="inline-flex min-h-9 items-center rounded-md px-3 text-sm font-semibold text-slate-500 hover:bg-slate-100"
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <aside className="space-y-5">
            <div className="rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
                <BarChart3 className="h-5 w-5 text-slate-700" />
                <h2 className="text-base font-bold text-slate-950">Automatic report pack</h2>
              </div>
              <div className="divide-y divide-slate-100">
                {playbook.reports.map((report) => (
                  <button
                    key={`${report.page}-${report.title}`}
                    type="button"
                    onClick={() => onNavigate(report.page)}
                    className="block w-full p-4 text-left hover:bg-slate-50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-slate-900">{report.title}</p>
                        <p className="mt-1 text-sm leading-5 text-slate-600">{report.note}</p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">{report.cadence}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-slate-700" />
                <h2 className="text-base font-bold text-slate-950">Signals checked</h2>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-slate-500">Products</dt><dd className="font-bold text-slate-950">{metrics.productsCount}</dd></div>
                <div><dt className="text-slate-500">GL accounts</dt><dd className="font-bold text-slate-950">{metrics.glAccountsCount}</dd></div>
                <div><dt className="text-slate-500">Departments</dt><dd className="font-bold text-slate-950">{metrics.departmentsCount}</dd></div>
                <div><dt className="text-slate-500">Imports</dt><dd className="font-bold text-slate-950">{metrics.migrationBatchesCount}</dd></div>
                <div><dt className="text-slate-500">Stock moves</dt><dd className="font-bold text-slate-950">{metrics.stockMovementsCount}</dd></div>
                <div><dt className="text-slate-500">Allocations</dt><dd className="font-bold text-slate-950">{metrics.costAllocationRunsCount}</dd></div>
              </dl>
            </div>

            <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
              <div className="flex items-start gap-3">
                <Sparkles className="mt-0.5 h-5 w-5 text-indigo-700" />
                <div>
                  <p className="text-sm font-bold text-indigo-950">Management pack standard</p>
                  <p className="mt-1 text-sm leading-5 text-indigo-800">
                    The report pack on this page is the default management review set for this business type. Use it to keep reporting uniform across organizations.
                  </p>
                </div>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}
