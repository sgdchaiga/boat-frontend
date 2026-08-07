import { supabase } from "@/lib/supabase";
import type { AssistantSuggestion } from "@/lib/userGuidance";
import { evaluateAssistantRisk } from "@/lib/boatAssistantRisk";

export type AssistantDecision = "confirmed" | "approval_required" | "approved" | "rejected" | "deferred" | "cancelled";

export type AssistantPolicy = {
  highValueThreshold: number;
  automaticEnabled: boolean;
};

export async function loadAssistantPolicy(organizationId: string): Promise<AssistantPolicy> {
  const { data } = await (supabase as any).from("boat_assistant_policies").select("high_value_threshold,automatic_enabled").eq("organization_id", organizationId).maybeSingle();
  return { highValueThreshold: Number(data?.high_value_threshold ?? 1000000), automaticEnabled: data?.automatic_enabled === true };
}

export function requiresAssistantApproval(suggestion: AssistantSuggestion, policy: AssistantPolicy): boolean {
  return evaluateAssistantRisk(suggestion, policy.highValueThreshold).approvalRequired;
}

export async function createAssistantSuggestion(params: {
  organizationId: string;
  userId: string;
  suggestion: AssistantSuggestion;
  approvalRequired: boolean;
}): Promise<{ id: string | null; duplicate: boolean }> {
  const { suggestion } = params;
  const duplicateResult = await (supabase as any).from("boat_assistant_suggestions").select("id").eq("organization_id", params.organizationId).eq("original_instruction", suggestion.originalInstruction).eq("amount", suggestion.amount).in("status", ["prepared", "confirmed", "approval_required", "approved", "deferred"]).limit(1);
  const duplicate = Boolean(duplicateResult.data?.length);
  const approvalRequired = params.approvalRequired || duplicate;
  const { data, error } = await (supabase as any).from("boat_assistant_suggestions").insert({
    organization_id: params.organizationId,
    created_by: params.userId,
    original_instruction: suggestion.originalInstruction,
    understood: suggestion.understood,
    recommended_treatment: suggestion.recommendedTreatment,
    draft: suggestion.draft,
    target_page: suggestion.page ?? null,
    amount: suggestion.amount,
    currency: suggestion.currency,
    confidence: suggestion.confidence,
    risk: suggestion.risk,
    status: approvalRequired ? "approval_required" : "prepared",
    approval_required: approvalRequired,
    assigned_role: approvalRequired ? (suggestion.risk === "high" ? "manager" : "accountant") : null,
  }).select("id").single();
  if (error) {
    console.warn("BOAT Assistant persistence unavailable:", error.message);
    return { id: null, duplicate };
  }
  return { id: String(data.id), duplicate };
}

export async function decideAssistantSuggestion(params: { organizationId: string; userId: string; suggestionId: string; decision: AssistantDecision; finalValues?: Record<string, unknown> }): Promise<boolean> {
  const review = params.decision === "approved" || params.decision === "rejected";
  const { error } = await (supabase as any).from("boat_assistant_suggestions").update({ status: params.decision, reviewed_by: review ? params.userId : null, reviewed_at: review ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq("id", params.suggestionId).eq("organization_id", params.organizationId);
  if (error) return false;
  await (supabase as any).from("boat_assistant_activity").insert({ organization_id: params.organizationId, suggestion_id: params.suggestionId, actor_id: params.userId, action: params.decision, final_values: params.finalValues ?? null });
  return true;
}

export async function loadAssistantAttention(organizationId: string) {
  const { data } = await (supabase as any).from("boat_assistant_suggestions").select("id,original_instruction,understood,status,risk,assigned_role,created_at").eq("organization_id", organizationId).in("status", ["approval_required", "deferred"]).order("created_at", { ascending: false }).limit(25);
  return (data ?? []) as Array<{ id: string; original_instruction: string; understood: string; status: string; risk: string; assigned_role: string | null; created_at: string }>;
}
