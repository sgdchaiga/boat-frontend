import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";

export function VslaReportsPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user, isSuperAdmin } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!isSuperAdmin;
  const [metrics, setMetrics] = useState({
    members: 0,
    activeLoans: 0,
    overdueLoans: 0,
    savingsValue: 0,
    cashSnapshots: 0,
  });

  const load = useCallback(async () => {
    const [m, l, s, c] = await Promise.all([
      filterByOrganizationId(supabase.from("vsla_members").select("id", { count: "exact", head: true }), orgId, superAdmin),
      filterByOrganizationId(supabase.from("vsla_loans").select("id,status,due_date,outstanding_balance"), orgId, superAdmin),
      filterByOrganizationId(supabase.from("vsla_share_transactions").select("total_value"), orgId, superAdmin),
      filterByOrganizationId(supabase.from("vsla_cashbox_snapshots").select("id", { count: "exact", head: true }), orgId, superAdmin),
    ]);
    const loans = (l.data ?? []) as Array<{ status: string; due_date: string | null; outstanding_balance: number }>;
    const overdue = loans.filter((x) => x.status === "disbursed" && x.outstanding_balance > 0 && !!x.due_date && new Date(x.due_date) < new Date()).length;
    const active = loans.filter((x) => x.status === "disbursed" && x.outstanding_balance > 0).length;
    const savings = ((s.data ?? []) as Array<{ total_value: number }>).reduce((sum, r) => sum + Number(r.total_value || 0), 0);
    setMetrics({
      members: m.count ?? 0,
      activeLoans: active,
      overdueLoans: overdue,
      savingsValue: savings,
      cashSnapshots: c.count ?? 0,
    });
  }, [orgId, superAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      {readOnly && <ReadOnlyNotice />}
      <h1 className="text-2xl font-bold text-slate-900">VSLA Reports</h1>
      <p className="text-sm text-slate-600">Starter reports for member statement, loans, savings, cash position, and share-out.</p>
      <div className="grid md:grid-cols-5 gap-3">
        <div className="bg-white border border-slate-200 rounded-lg p-3 text-sm">Members<br /><strong>{metrics.members}</strong></div>
        <div className="bg-white border border-slate-200 rounded-lg p-3 text-sm">Active Loans<br /><strong>{metrics.activeLoans}</strong></div>
        <div className="bg-white border border-slate-200 rounded-lg p-3 text-sm">Overdue Loans<br /><strong>{metrics.overdueLoans}</strong></div>
        <div className="bg-white border border-slate-200 rounded-lg p-3 text-sm">Savings Value<br /><strong>{metrics.savingsValue.toLocaleString()}</strong></div>
        <div className="bg-white border border-slate-200 rounded-lg p-3 text-sm">Cash Snapshots<br /><strong>{metrics.cashSnapshots}</strong></div>
      </div>
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900">
        Export to Excel/PDF and SMS summaries can be added next.
      </div>
    </div>
  );
}
