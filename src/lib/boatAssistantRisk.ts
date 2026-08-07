import type { AssistantSuggestion } from "@/lib/userGuidance";

export type RiskDecision = {
  risk: "low" | "medium" | "high";
  approvalRequired: boolean;
  automaticBlocked: boolean;
  reasons: string[];
  fingerprint: string;
};

const IRREVERSIBLE = /\b(delete|write[- ]?off|close period|submit tax|opening balance|change permission|disburse|change price)\b/i;
const SENSITIVE = /\b(supplier payment|pay supplier|loan|journal|asset|equipment|stock adjustment|withdraw)\b/i;

export function assistantFingerprint(input: Pick<AssistantSuggestion, "draft">): string {
  const d = input.draft;
  return [d.transactionType, d.counterparty?.toLowerCase().trim() ?? "", d.amount ?? "", d.currency ?? "", d.date, d.description.toLowerCase().replace(/\s+/g, " ").trim()].join("|");
}

export function evaluateAssistantRisk(suggestion: AssistantSuggestion, highValueThreshold: number): RiskDecision {
  const reasons: string[] = [];
  const irreversible = IRREVERSIBLE.test(suggestion.originalInstruction);
  const sensitive = SENSITIVE.test(suggestion.originalInstruction);
  const highValue = suggestion.amount !== null && suggestion.amount >= highValueThreshold;
  if (irreversible) reasons.push("Unusual or irreversible action");
  if (sensitive) reasons.push("Sensitive accounting or payment treatment");
  if (highValue) reasons.push(`Amount meets the approval threshold of ${highValueThreshold.toLocaleString()}`);
  if (suggestion.confidence === "low") reasons.push("Low-confidence interpretation requires clarification");
  const risk = irreversible || highValue ? "high" : sensitive ? "medium" : suggestion.risk;
  return { risk, approvalRequired: irreversible || sensitive || highValue, automaticBlocked: irreversible || sensitive || highValue || suggestion.confidence !== "high", reasons, fingerprint: assistantFingerprint(suggestion) };
}
