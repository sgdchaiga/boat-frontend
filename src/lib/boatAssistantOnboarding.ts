import { supabase } from "@/lib/supabase";

export type AssistantOnboardingAnswers = { businessType: string; productsServices: string; creditSales: boolean; stock: boolean; paymentMethods: string[]; vatRegistered: boolean; employees: boolean; branches: boolean; approvals: boolean; assistanceMode: string };

export function proposeAssistantConfiguration(answers: AssistantOnboardingAnswers) {
  return { assistanceMode: answers.assistanceMode || "guided", enableInventoryWorkflow: answers.stock, enableReceivablesWorkflow: answers.creditSales, enablePayrollSuggestions: answers.employees, enableBranchContext: answers.branches, requireSensitiveApprovals: true, requireHighValueApprovals: answers.approvals, paymentMethods: answers.paymentMethods, taxGuidance: answers.vatRegistered ? "vat_registered" : "not_vat_registered", businessDescription: answers.productsServices };
}

export async function saveAssistantOnboarding(organizationId: string, userId: string, answers: AssistantOnboardingAnswers, activate = false) {
  const proposed = proposeAssistantConfiguration(answers);
  const now = new Date().toISOString();
  const { error } = await (supabase as any).from("boat_assistant_onboarding").upsert({ organization_id: organizationId, answers, proposed_configuration: proposed, status: activate ? "active" : "proposed", proposed_by: userId, proposed_at: now, activated_by: activate ? userId : null, activated_at: activate ? now : null, updated_at: now }, { onConflict: "organization_id" });
  return { proposed, error: error?.message ?? null };
}
