import { supabase } from "@/lib/supabase";

/** Best-effort audit row; failures are logged to console only. */
export async function logPayrollAudit(params: {
  organizationId: string;
  actorStaffId: string;
  action: string;
  payrollRunId?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabase.from("payroll_audit_log").insert({
    organization_id: params.organizationId,
    payroll_run_id: params.payrollRunId ?? null,
    actor_staff_id: params.actorStaffId,
    action: params.action,
    details: params.details ?? {},
  });
  if (error) console.warn("payroll audit log:", error.message);
}
