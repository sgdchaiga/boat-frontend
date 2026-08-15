import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CalendarDays, Coins, PiggyBank, Users, Wallet } from "lucide-react";
import { VSLA_PAGE } from "@/lib/vslaPages";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";

type Props = { onNavigate?: (page: string, state?: Record<string, unknown>) => void; readOnly?: boolean };
type Cycle = { id: string; name: string; starts_on: string };
type Metrics = {
  activeMembers: number;
  savings: number;
  activeLoans: number;
  overdueLoans: number;
  nextMeeting: string | null;
  openMeetingId: string | null;
  cashVariance: number | null;
};

const emptyMetrics: Metrics = { activeMembers: 0, savings: 0, activeLoans: 0, overdueLoans: 0, nextMeeting: null, openMeetingId: null, cashVariance: null };

export function VslaDashboardPage({ onNavigate, readOnly = false }: Props) {
  const { user, isSuperAdmin } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!isSuperAdmin;
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [metrics, setMetrics] = useState<Metrics>(emptyMetrics);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const cycleRes = await filterByOrganizationId(
      supabase.from("vsla_cycles").select("id,name,starts_on").eq("status", "active").maybeSingle(),
      orgId,
      superAdmin,
    );
    const activeCycle = (cycleRes.data as Cycle | null) ?? null;
    setCycle(activeCycle);
    const cycleId = activeCycle?.id ?? "00000000-0000-0000-0000-000000000000";
    const [membersRes, sharesRes, loansRes, meetingsRes, cashRes] = await Promise.all([
      filterByOrganizationId(supabase.from("vsla_members").select("id", { count: "exact", head: true }).eq("status", "active"), orgId, superAdmin),
      filterByOrganizationId(supabase.from("vsla_share_transactions").select("total_value").eq("cycle_id", cycleId), orgId, superAdmin),
      filterByOrganizationId(supabase.from("vsla_loans").select("status,due_date,outstanding_balance").eq("cycle_id", cycleId), orgId, superAdmin),
      filterByOrganizationId(supabase.from("vsla_meetings").select("id,meeting_date,status").eq("cycle_id", cycleId).order("meeting_date"), orgId, superAdmin),
      filterByOrganizationId(supabase.from("vsla_cashbox_snapshots").select("opening_cash,inflow_savings,inflow_repayments,inflow_fines,outflow_loans,outflow_social_payouts,physical_cash").eq("cycle_id", cycleId).order("created_at", { ascending: false }).limit(1), orgId, superAdmin),
    ]);
    const loans = (loansRes.data ?? []) as Array<{ status: string; due_date: string | null; outstanding_balance: number }>;
    const meetings = (meetingsRes.data ?? []) as Array<{ id: string; meeting_date: string; status: string }>;
    const today = new Date().toISOString().slice(0, 10);
    const next = meetings.find((meeting) => meeting.status !== "closed" && meeting.meeting_date >= today) ?? meetings.find((meeting) => meeting.status === "open") ?? null;
    const openMeeting = meetings.find((meeting) => meeting.status === "open") ?? null;
    const cash = (cashRes.data?.[0] as { opening_cash: number; inflow_savings: number; inflow_repayments: number; inflow_fines: number; outflow_loans: number; outflow_social_payouts: number; physical_cash: number | null } | undefined);
    const expectedCash = cash ? Number(cash.opening_cash || 0) + Number(cash.inflow_savings || 0) + Number(cash.inflow_repayments || 0) + Number(cash.inflow_fines || 0) - Number(cash.outflow_loans || 0) - Number(cash.outflow_social_payouts || 0) : null;
    setMetrics({
      activeMembers: membersRes.count ?? 0,
      savings: ((sharesRes.data ?? []) as Array<{ total_value: number }>).reduce((sum, row) => sum + Number(row.total_value || 0), 0),
      activeLoans: loans.filter((loan) => loan.status === "disbursed" && Number(loan.outstanding_balance) > 0).length,
      overdueLoans: loans.filter((loan) => loan.status === "disbursed" && Number(loan.outstanding_balance) > 0 && !!loan.due_date && loan.due_date < today).length,
      nextMeeting: next?.meeting_date ?? null,
      openMeetingId: openMeeting?.id ?? null,
      cashVariance: cash?.physical_cash == null || expectedCash == null ? null : Number(cash.physical_cash) - expectedCash,
    });
    setError(cycleRes.error?.message ?? membersRes.error?.message ?? sharesRes.error?.message ?? loansRes.error?.message ?? meetingsRes.error?.message ?? cashRes.error?.message ?? null);
    setLoading(false);
  }, [orgId, superAdmin]);

  useEffect(() => { void load(); }, [load]);

  const kpis = [
    { label: "Active Members", value: metrics.activeMembers.toLocaleString(), icon: Users, page: VSLA_PAGE.members },
    { label: "Cycle Savings", value: metrics.savings.toLocaleString(), icon: Wallet, page: VSLA_PAGE.savings },
    { label: "Active Loans", value: metrics.activeLoans.toLocaleString(), icon: PiggyBank, page: VSLA_PAGE.loans },
    { label: "Overdue Loans", value: metrics.overdueLoans.toLocaleString(), icon: Coins, page: VSLA_PAGE.repayments, alert: metrics.overdueLoans > 0 },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {readOnly && <ReadOnlyNotice />}
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div><h1 className="text-2xl font-bold text-slate-900">VSLA Dashboard</h1><p className="text-sm text-slate-600 mt-1">Current-cycle activity and meeting-day shortcuts.</p></div>
        {cycle ? <div className="rounded-lg bg-indigo-50 border border-indigo-200 px-3 py-2 text-sm text-indigo-950"><strong>{cycle.name}</strong> · Since {cycle.starts_on}</div> : <button type="button" onClick={() => onNavigate?.(VSLA_PAGE.shareOut)} className="rounded-lg bg-amber-100 border border-amber-300 px-3 py-2 text-sm font-medium text-amber-950">Start a VSLA cycle</button>}
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map(({ label, value, icon: Icon, page, alert }) => <button key={label} type="button" onClick={() => onNavigate?.(page)} className={`text-left rounded-xl border bg-white p-4 shadow-sm hover:bg-slate-50 ${alert ? "border-rose-300" : "border-slate-200"}`}><div className="flex items-center justify-between"><Icon className={`w-5 h-5 ${alert ? "text-rose-600" : "text-indigo-600"}`} /><ArrowRight className="w-4 h-4 text-slate-400" /></div><p className="mt-3 text-2xl font-bold text-slate-900">{loading ? "—" : value}</p><p className="text-xs text-slate-600">{label}</p></button>)}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <section className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div><h2 className="font-semibold text-slate-900">Meeting Day</h2><p className="text-sm text-slate-600">Use one workspace for attendance, shares, loans, repayments and the cash summary.</p></div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="rounded-lg bg-slate-50 p-3 text-sm"><span className="text-slate-500">Next meeting</span><p className="font-semibold text-slate-900 mt-1">{metrics.nextMeeting ?? "Not scheduled"}</p></div>
            <div className={`rounded-lg p-3 text-sm ${metrics.cashVariance != null && metrics.cashVariance !== 0 ? "bg-rose-50" : "bg-slate-50"}`}><span className="text-slate-500">Latest cash variance</span><p className="font-semibold text-slate-900 mt-1">{metrics.cashVariance == null ? "Not reconciled" : metrics.cashVariance.toLocaleString()}</p></div>
          </div>
          <button type="button" onClick={() => onNavigate?.(VSLA_PAGE.meetings)} className="inline-flex items-center gap-2 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white"><CalendarDays className="w-4 h-4" />{metrics.openMeetingId ? "Continue Open Meeting" : "Open Meeting Workspace"}</button>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
          <h2 className="font-semibold text-slate-900">Quick Actions</h2>
          {[
            ["Register Member", VSLA_PAGE.members], ["Record Shares", VSLA_PAGE.savings], ["Record Repayment", VSLA_PAGE.repayments], ["Reconcile Cashbox", VSLA_PAGE.cashbox], ["Member Statement", VSLA_PAGE.memberStatement], ["Reports", VSLA_PAGE.reports], ["Share-Out", VSLA_PAGE.shareOut],
          ].map(([label, page]) => <button key={page} type="button" onClick={() => onNavigate?.(page)} className="w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"><span>{label}</span><ArrowRight className="w-4 h-4 text-slate-400" /></button>)}
        </section>
      </div>
    </div>
  );
}
