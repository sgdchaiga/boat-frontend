import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CalendarRange, Calculator, CircleDollarSign, MinusCircle, ScrollText, Settings2, Users, Wallet } from "lucide-react";
import { PAYROLL_PAGE } from "@/lib/payrollPages";
import { PayrollGuide } from "@/components/payroll/PayrollGuide";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { payrollBusinessLabel } from "@/lib/payrollBusiness";

type Props = { onNavigate: (page: string) => void };
type PayrollRun = { id: string; status: string; payroll_period_id: string };
type PayrollLine = { gross_pay: number; paye: number; nssf_employee: number; nssf_employer: number; loan_deduction: number; net_pay: number };

const workspaceCards: { title: string; desc: string; page: string; icon: typeof Users }[] = [
  { title: "Employees", desc: "Maintain payroll eligibility and employment information.", page: PAYROLL_PAGE.staff, icon: Users },
  { title: "Salary structure", desc: "Maintain basic salary, allowances and recurring deductions.", page: PAYROLL_PAGE.salary, icon: Wallet },
  { title: "Payroll periods", desc: "Create and manage the monthly periods used for payroll processing.", page: PAYROLL_PAGE.periods, icon: CalendarRange },
  { title: "Process payroll", desc: "Calculate payroll, review results, approve and post with separate controls.", page: PAYROLL_PAGE.run, icon: Calculator },
  { title: "Loans & advances", desc: "Manage salary advances and deductions recovered through payroll.", page: PAYROLL_PAGE.loans, icon: MinusCircle },
  { title: "Settings & accounting", desc: "Configure statutory rates, working days and payroll GL accounts.", page: PAYROLL_PAGE.settings, icon: Settings2 },
  { title: "Review & approve", desc: "Review calculated payroll and approve exceptions before payment.", page: PAYROLL_PAGE.review, icon: ScrollText },
  { title: "Payments", desc: "Prepare payment schedules and track failed or returned payments.", page: PAYROLL_PAGE.payments, icon: Wallet },
  { title: "Statutory deductions", desc: "Track PAYE, NSSF and other liabilities through remittance.", page: PAYROLL_PAGE.statutory, icon: Settings2 },
  { title: "Payroll reports", desc: "Open employee, management, compliance and accounting reports.", page: PAYROLL_PAGE.reports, icon: ScrollText },
];

const statusTone: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  calculated: "bg-blue-100 text-blue-700",
  approved: "bg-emerald-100 text-emerald-700",
  posted: "bg-violet-100 text-violet-700",
};

export function PayrollHubPage({ onNavigate }: Props) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const [loading, setLoading] = useState(true);
  const [periodLabel, setPeriodLabel] = useState("No payroll period");
  const [run, setRun] = useState<PayrollRun | null>(null);
  const [activeEmployees, setActiveEmployees] = useState(0);
  const [lines, setLines] = useState<PayrollLine[]>([]);

  const loadOverview = useCallback(async () => {
    if (!orgId) { setLoading(false); return; }
    setLoading(true);
    const [profilesResult, periodResult] = await Promise.all([
      supabase.from("payroll_employee_profiles").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("is_on_payroll", true),
      supabase.from("payroll_periods").select("id,label").eq("organization_id", orgId).order("period_end", { ascending: false }).limit(1).maybeSingle(),
    ]);
    setActiveEmployees(profilesResult.count ?? 0);
    const period = periodResult.data as { id: string; label: string } | null;
    setPeriodLabel(period?.label ?? "No payroll period");
    if (!period) { setRun(null); setLines([]); setLoading(false); return; }
    const runResult = await supabase.from("payroll_runs").select("id,status,payroll_period_id").eq("payroll_period_id", period.id).maybeSingle();
    const latestRun = runResult.data as PayrollRun | null;
    setRun(latestRun);
    if (latestRun) {
      const lineResult = await supabase.from("payroll_run_lines").select("gross_pay,paye,nssf_employee,nssf_employer,loan_deduction,net_pay").eq("payroll_run_id", latestRun.id);
      setLines((lineResult.data as PayrollLine[]) ?? []);
    } else setLines([]);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { void loadOverview(); }, [loadOverview]);

  const totals = lines.reduce((sum, line) => ({
    gross: sum.gross + Number(line.gross_pay || 0),
    deductions: sum.deductions + Number(line.paye || 0) + Number(line.nssf_employee || 0) + Number(line.loan_deduction || 0),
    net: sum.net + Number(line.net_pay || 0),
    employer: sum.employer + Number(line.gross_pay || 0) + Number(line.nssf_employer || 0),
  }), { gross: 0, deductions: 0, net: 0, employer: 0 });

  const summaryCards = [
    { label: "Active employees", value: activeEmployees.toLocaleString(), accent: "border-t-slate-800", tone: "text-slate-900" },
    { label: "Gross payroll", value: totals.gross.toLocaleString(), accent: "border-t-blue-600", tone: "text-blue-700" },
    { label: "Total deductions", value: totals.deductions.toLocaleString(), accent: "border-t-amber-500", tone: "text-amber-700" },
    { label: "Net pay", value: totals.net.toLocaleString(), accent: "border-t-teal-600", tone: "text-teal-700" },
    { label: "Employer cost", value: totals.employer.toLocaleString(), accent: "border-t-violet-600", tone: "text-violet-700" },
  ];

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <nav aria-label="Breadcrumb" className="text-xs font-medium text-slate-500">{payrollBusinessLabel(user?.business_type)} <span className="mx-1 text-slate-300">›</span> Payroll <span className="mx-1 text-slate-300">›</span> <span className="text-slate-700">Overview</span></nav>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-2">
          <div><h1 className="text-2xl font-bold tracking-tight text-slate-900">Payroll Overview</h1><p className="mt-1 text-sm text-slate-600">Monitor payroll costs, processing progress and employee payments.</p></div>
          <PayrollGuide guideId="hub" />
        </div>
        <button type="button" onClick={() => onNavigate(PAYROLL_PAGE.run)} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-slate-800"><Calculator className="h-4 w-4" />Process payroll</button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">Current payroll period</p><p className="mt-0.5 font-semibold text-slate-900">{periodLabel}</p></div>
        {run ? <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${statusTone[run.status] ?? statusTone.draft}`}>{run.status}</span> : <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">Not prepared</span>}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {summaryCards.map((card) => <div key={card.label} className={`rounded-xl border border-t-2 border-slate-200 bg-white p-4 ${card.accent}`}><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{card.label}</p><p className={`mt-1 text-xl font-bold tabular-nums ${card.tone}`}>{loading ? "…" : card.value}</p></div>)}
      </div>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3"><div><h2 className="text-base font-semibold text-slate-900">Payroll workspace</h2><p className="text-sm text-slate-500">Work through payroll in a clear prepare, review and post sequence.</p></div><Wallet className="h-5 w-5 text-slate-400" /></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workspaceCards.map((card) => <button key={card.page} type="button" onClick={() => onNavigate(card.page)} className="group flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 text-left transition hover:border-slate-300 hover:shadow-sm"><div className="flex items-center justify-between gap-3"><span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-teal-50 text-teal-700"><card.icon className="h-5 w-5" aria-hidden /></span><ArrowRight className="h-4 w-4 text-slate-400 transition group-hover:translate-x-0.5" aria-hidden /></div><div><h3 className="font-semibold text-slate-900">{card.title}</h3><p className="mt-1 text-sm leading-5 text-slate-600">{card.desc}</p></div></button>)}
        </div>
      </section>

      {!loading && !run && <div className="flex items-start gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-5"><CircleDollarSign className="mt-0.5 h-5 w-5 text-slate-500" /><div><p className="font-medium text-slate-800">No payroll has been prepared for {periodLabel.toLowerCase()}.</p><button type="button" onClick={() => onNavigate(PAYROLL_PAGE.run)} className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-teal-700 hover:text-teal-800">Start payroll processing <ArrowRight className="h-3.5 w-3.5" /></button></div></div>}
    </div>
  );
}
