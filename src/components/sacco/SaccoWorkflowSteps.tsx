import { Check } from "lucide-react";

type Props = {
  steps: readonly string[];
  currentStep: number;
  ariaLabel: string;
};

export function SaccoWorkflowSteps({ steps, currentStep, ariaLabel }: Props) {
  return (
    <ol aria-label={ariaLabel} className="grid gap-2 sm:grid-cols-4">
      {steps.map((step, index) => {
        const number = index + 1;
        const complete = number < currentStep;
        const active = number === currentStep;
        return (
          <li
            key={step}
            aria-current={active ? "step" : undefined}
            className={`flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${
              active
                ? "border-emerald-500 bg-emerald-50 text-emerald-900"
                : complete
                  ? "border-emerald-200 bg-white text-emerald-700"
                  : "border-slate-200 bg-white text-slate-500"
            }`}
          >
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
              active || complete ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"
            }`}>
              {complete ? <Check size={14} aria-hidden /> : number}
            </span>
            <span className="truncate">{step}</span>
          </li>
        );
      })}
    </ol>
  );
}
