import { Factory, ArrowRight } from "lucide-react";
import { ReadOnlyNotice } from "../common/ReadOnlyNotice";

type Props = {
  onNavigate?: (page: string, state?: Record<string, unknown>) => void;
  readOnly?: boolean;
};

const starterCards = [
  {
    title: "Bill of materials",
    desc: "Define raw materials and quantities for each finished product.",
    page: "manufacturing_bom",
  },
  {
    title: "Work orders",
    desc: "Issue production jobs, assign dates, and track execution status.",
    page: "manufacturing_work_orders",
  },
  {
    title: "Production entries",
    desc: "Record consumed materials and produced quantities for posting.",
    page: "manufacturing_production_entries",
  },
  {
    title: "Costing",
    desc: "Review material and labor costs before posting to inventory/GL.",
    page: "manufacturing_costing",
  },
] as const;

export function ManufacturingPage({ onNavigate, readOnly = false }: Props) {
  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      {readOnly && <ReadOnlyNotice />}
      <div className="flex items-center gap-3">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
          <Factory className="w-6 h-6" aria-hidden />
        </span>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Manufacturing</h1>
          <p className="text-sm text-slate-600">Starter module scaffold for production workflows.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {starterCards.map((card) => (
          <button
            key={card.page}
            type="button"
            onClick={() => onNavigate?.(card.page)}
            className="text-left rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-slate-300 hover:bg-slate-50/80 transition flex flex-col gap-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-900">{card.title}</span>
              <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
            </div>
            <p className="text-sm text-slate-600">{card.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
