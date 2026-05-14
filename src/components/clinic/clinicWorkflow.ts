import type { ClinicWorkflowStep } from "./clinicTypes";

const STEP_ORDER: ClinicWorkflowStep[] = ["reception", "doctor", "pharmacy", "payment"];

export function nextWorkflowStep(step: ClinicWorkflowStep): ClinicWorkflowStep {
  const i = STEP_ORDER.indexOf(step);
  if (i < 0 || i >= STEP_ORDER.length - 1) return "payment";
  return STEP_ORDER[i + 1]!;
}

export function prevWorkflowStep(step: ClinicWorkflowStep): ClinicWorkflowStep {
  const i = STEP_ORDER.indexOf(step);
  if (i <= 0) return "reception";
  return STEP_ORDER[i - 1]!;
}
