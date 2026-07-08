import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronRight, ClipboardCheck, EyeOff, Loader2 } from "lucide-react";

import { useAuth, type BusinessType } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

type Step = {
  id: string;
  title: string;
  note: string;
  page?: string;
};

type OnboardingStateRow = {
  organization_id: string;
  business_type: string;
  country: string | null;
  currency: string | null;
  answers: Record<string, unknown>;
  template_defaults?: Record<string, unknown> | null;
  completed_steps: string[] | null;
  dismissed_at: string | null;
};

function firstSetupPage(businessType: BusinessType | null | undefined): string {
  if (businessType === "manufacturing") return "manufacturing";
  if (businessType === "sacco") return "sacco_overview";
  if (businessType === "vsla") return "vsla_dashboard";
  if (businessType === "school") return "school_dashboard";
  if (businessType === "clinic") return "clinic_dashboard";
  if (businessType === "retail" || businessType === "restaurant" || businessType === "agriculture") return "retail_dashboard";
  return "dashboard";
}

function firstCustomerPage(businessType: BusinessType | null | undefined): string {
  if (businessType === "sacco") return "sacco_members";
  if (businessType === "vsla") return "vsla_members";
  if (businessType === "school") return "school_students";
  if (businessType === "clinic") return "clinic_patients";
  if (businessType === "hotel") return "hotel_customers";
  return "retail_customers";
}

function firstProductPage(businessType: BusinessType | null | undefined): string {
  if (businessType === "manufacturing") return "manufacturing_bom";
  if (businessType === "sacco") return "sacco_loan_settings";
  if (businessType === "vsla") return "vsla_controls";
  if (businessType === "school") return "school_fee_structures";
  if (businessType === "clinic") return "Products";
  return "Products";
}

function firstSalePage(businessType: BusinessType | null | undefined): string {
  if (businessType === "manufacturing") return "manufacturing_production_entries";
  if (businessType === "sacco") return "sacco_teller";
  if (businessType === "vsla") return "vsla_savings";
  if (businessType === "school") return "school_fee_payments";
  if (businessType === "clinic") return "clinic_pos";
  if (businessType === "hotel") return "checkin";
  return "retail_pos";
}

function reportPage(businessType: BusinessType | null | undefined): string {
  if (businessType === "school") return "reports_school_fee_collections";
  if (businessType === "manufacturing") return "reports_manufacturing_daily_production";
  if (businessType === "sacco") return "sacco_financial_summaries";
  if (businessType === "vsla") return "vsla_reports";
  return "reports";
}

function stepsForBusinessType(businessType: BusinessType | null | undefined): Step[] {
  return [
    {
      id: "choose_template",
      title: "Business template selected",
      note: "BOAT selected the right module mix for this business type.",
      page: firstSetupPage(businessType),
    },
    {
      id: "smart_defaults",
      title: "Smart defaults created",
      note: "Chart of accounts, journal settings, cost centres, roles, departments, and starter records are ready to verify.",
      page: "admin",
    },
    {
      id: "verify_defaults",
      title: "Verify default settings",
      note: "Review and adjust the template before daily transactions begin.",
      page: "admin",
    },
    {
      id: "import_data",
      title: "Import existing data",
      note: "Bring in customers, suppliers, products, stock counts, Google Sheets data, or opening balances.",
      page: "data_migration",
    },
    {
      id: "first_contact",
      title: "Create the first customer, member, patient, or student",
      note: "Start with the people or organizations you transact with.",
      page: firstCustomerPage(businessType),
    },
    {
      id: "first_item",
      title: "Create the first product, service, fee, or recipe",
      note: "Add the item that will appear on your first transaction.",
      page: firstProductPage(businessType),
    },
    {
      id: "first_purchase",
      title: "Record the first purchase or expense",
      note: "Capture a supplier bill, stock purchase, or operating expense.",
      page: "purchases_expenses",
    },
    {
      id: "first_sale",
      title: "Record the first sale, receipt, or production transaction",
      note: "This is the 15-minute success target for a new BOAT workspace.",
      page: firstSalePage(businessType),
    },
    {
      id: "first_report",
      title: "View the first report",
      note: "Confirm the transaction appears in reporting.",
      page: reportPage(businessType),
    },
  ];
}

export function OnboardingChecklist({ onNavigate }: { onNavigate: (page: string) => void }) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const businessType = user?.business_type ?? null;
  const [row, setRow] = useState<OnboardingStateRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingStep, setSavingStep] = useState<string | null>(null);

  const steps = useMemo(() => stepsForBusinessType(businessType), [businessType]);
  const completed = useMemo(() => new Set(row?.completed_steps ?? []), [row?.completed_steps]);
  const completeCount = steps.filter((step) => completed.has(step.id)).length;
  const isComplete = completeCount >= steps.length;

  useEffect(() => {
    if (!orgId || user?.isSuperAdmin || user?.isSaccoMember) {
      setRow(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      const { data } = await supabase
        .from("organization_onboarding_state")
        .select("organization_id,business_type,country,currency,answers,template_defaults,completed_steps,dismissed_at")
        .eq("organization_id", orgId)
        .maybeSingle();
      if (!cancelled) {
        setRow((data as OnboardingStateRow | null) ?? null);
        setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [orgId, user?.isSaccoMember, user?.isSuperAdmin]);

  const updateSteps = async (nextSteps: string[], dismiss?: boolean, savingId = "saving") => {
    if (!orgId) return;
    setSavingStep(savingId);
    const { data, error } = await supabase.rpc("update_organization_onboarding_state", {
      p_organization_id: orgId,
      p_completed_steps: nextSteps,
      p_dismissed: dismiss ?? null,
    });
    setSavingStep(null);
    if (!error && data) setRow(data as OnboardingStateRow);
  };

  const toggleStep = (stepId: string) => {
    const next = new Set(completed);
    if (next.has(stepId)) next.delete(stepId);
    else next.add(stepId);
    void updateSteps(Array.from(next), undefined, stepId);
  };

  if (!orgId || user?.isSuperAdmin || user?.isSaccoMember) return null;
  if (row?.dismissed_at || isComplete) return null;

  return (
    <section className="mb-4 rounded-lg border border-emerald-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-emerald-100 bg-emerald-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-emerald-600 p-2 text-white">
            <ClipboardCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-emerald-950">Finish setting up your workspace</h2>
            <p className="text-sm text-emerald-800">
              {loading ? "Checking setup progress..." : `${completeCount} of ${steps.length} steps complete`}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void updateSteps(Array.from(completed), true, "dismiss")}
          className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-emerald-200 bg-white px-3 text-sm font-semibold text-emerald-800 hover:bg-emerald-50"
        >
          {savingStep === "dismiss" ? <Loader2 className="h-4 w-4 animate-spin" /> : <EyeOff className="h-4 w-4" />}
          Hide
        </button>
      </div>

      <div className="grid gap-2 p-3 lg:grid-cols-2">
        {steps.map((step) => {
          const done = completed.has(step.id);
          return (
            <div key={step.id} className="flex items-start gap-3 rounded-md border border-slate-200 p-3">
              <button
                type="button"
                onClick={() => toggleStep(step.id)}
                className={`mt-0.5 rounded-full ${done ? "text-emerald-600" : "text-slate-300 hover:text-emerald-500"}`}
                aria-label={done ? `Mark ${step.title} incomplete` : `Mark ${step.title} complete`}
              >
                {savingStep === step.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
              </button>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-bold ${done ? "text-slate-500 line-through" : "text-slate-900"}`}>{step.title}</p>
                <p className="mt-0.5 text-xs leading-5 text-slate-500">{step.note}</p>
              </div>
              {step.page ? (
                <button
                  type="button"
                  onClick={() => onNavigate(step.page!)}
                  className="inline-flex min-h-9 items-center gap-1 rounded-md border border-slate-200 px-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Open <ChevronRight className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
