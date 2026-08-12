import { useAuth } from "@/contexts/AuthContext";
import { SchoolBudgetCompletionPanel } from "@/components/accounting/SchoolBudgetCompletionPanel";
import { canApprove } from "@/lib/permissions";

export function SchoolBudgetCompletionAdminPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user } = useAuth();
  const organizationId = user?.organization_id;
  if (!organizationId) return <p className="p-6 text-slate-600">Select an organization.</p>;
  return <div className="mx-auto max-w-6xl space-y-4 p-6 lg:p-8"><div><p className="text-xs font-bold uppercase tracking-wide text-indigo-700">Admin · School rollout</p><h1 className="text-2xl font-bold text-slate-900">Implementation completion centre</h1><p className="mt-1 text-sm text-slate-600">Administrative setup, migration, acceptance testing, backup readiness and training evidence.</p></div><SchoolBudgetCompletionPanel organizationId={organizationId} userId={user?.id} disabled={readOnly||!canApprove("budget_prepare",user?.role)} onImported={()=>undefined}/></div>;
}
