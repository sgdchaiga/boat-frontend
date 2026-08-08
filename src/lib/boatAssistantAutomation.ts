import { supabase } from "@/lib/supabase";

export type AssistantAutomationRule = {
  id: string; organization_id: string; name: string; action_type: "create_action_item" | "prepare_transaction_draft";
  instruction: string; target_page: string | null; draft: Record<string, unknown>; requires_approval: boolean;
  assigned_role: "admin" | "manager" | "accountant"; schedule_kind: "daily" | "weekly" | "monthly";
  run_time: string; timezone: string; weekday: number | null; day_of_month: number | null; next_run_at: string; active: boolean;
};

export async function loadAssistantAutomationRules(organizationId: string) {
  const { data, error } = await (supabase as any).from("boat_assistant_automation_rules").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false });
  return { rules: (data ?? []) as AssistantAutomationRule[], error: error?.message ?? null };
}

export async function saveAssistantAutomationRule(input: Omit<AssistantAutomationRule, "id" | "next_run_at"> & { id?: string; userId: string }) {
  const next = nextRun(input.schedule_kind, input.run_time, input.weekday, input.day_of_month);
  const row = { organization_id: input.organization_id, name: input.name.trim(), action_type: input.action_type, instruction: input.instruction.trim(), target_page: input.target_page || null, draft: input.draft, requires_approval: input.action_type === "prepare_transaction_draft" ? true : input.requires_approval, assigned_role: input.assigned_role, schedule_kind: input.schedule_kind, run_time: input.run_time, timezone: input.timezone, weekday: input.schedule_kind === "weekly" ? input.weekday : null, day_of_month: input.schedule_kind === "monthly" ? input.day_of_month : null, next_run_at: next, active: input.active, created_by: input.userId, updated_by: input.userId, updated_at: new Date().toISOString() };
  const query = input.id ? (supabase as any).from("boat_assistant_automation_rules").update(row).eq("id", input.id).eq("organization_id", input.organization_id) : (supabase as any).from("boat_assistant_automation_rules").insert(row);
  const { error } = await query;
  return error?.message ?? null;
}

export async function deleteAssistantAutomationRule(organizationId: string, id: string) {
  const { error } = await (supabase as any).from("boat_assistant_automation_rules").delete().eq("id", id).eq("organization_id", organizationId);
  return error?.message ?? null;
}

export async function setAssistantAutomaticEnabled(organizationId: string, userId: string, enabled: boolean) {
  if (enabled) {
    const { count } = await (supabase as any).from("boat_assistant_automation_rules").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("active", true);
    if (!count) return "Create and activate at least one rule first.";
  }
  const { error } = await (supabase as any).from("boat_assistant_policies").upsert({ organization_id: organizationId, automatic_enabled: enabled, default_mode: enabled ? "automatic" : "guided", updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "organization_id" });
  return error?.message ?? null;
}

function nextRun(kind: AssistantAutomationRule["schedule_kind"], time: string, weekday: number | null, day: number | null) {
  const now = new Date(); const [hour, minute] = time.split(":").map(Number); const next = new Date(now); next.setHours(hour || 0, minute || 0, 0, 0);
  if (kind === "daily" && next <= now) next.setDate(next.getDate() + 1);
  if (kind === "weekly") { const add = ((weekday ?? 1) - next.getDay() + 7) % 7; next.setDate(next.getDate() + add); if (next <= now) next.setDate(next.getDate() + 7); }
  if (kind === "monthly") { next.setDate(Math.min(day ?? 1, 28)); if (next <= now) next.setMonth(next.getMonth() + 1); }
  return next.toISOString();
}
