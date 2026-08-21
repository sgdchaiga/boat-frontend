import { useState } from "react";
import { SchoolClassesPage } from "./SchoolClassesPage";
import { SchoolStreamsPage } from "./SchoolStreamsPage";

type Props = { readOnly?: boolean; initialTab?: "classes" | "streams" };

export function SchoolClassesStreamsPage({ readOnly, initialTab = "classes" }: Props) {
  const [tab, setTab] = useState<"classes" | "streams">(initialTab);

  return (
    <div className="space-y-4">
      <div className="mx-auto max-w-7xl px-6 pt-6 lg:px-8">
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm" role="tablist" aria-label="Academic structure">
          {(["classes", "streams"] as const).map((item) => (
            <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)} className={`rounded-lg px-5 py-2 text-sm font-semibold capitalize transition ${tab === item ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
              {item}
            </button>
          ))}
        </div>
      </div>
      {tab === "classes" ? <SchoolClassesPage readOnly={readOnly} /> : <SchoolStreamsPage readOnly={readOnly} />}
    </div>
  );
}
