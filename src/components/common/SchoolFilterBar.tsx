import { Filter, X } from "lucide-react";
import { useState, type ReactNode } from "react";

export type SchoolFilterChip = {
  key: string;
  label: string;
  onRemove: () => void;
};

type SchoolFilterBarProps = {
  search?: ReactNode;
  period?: ReactNode;
  children: ReactNode;
  activeFilters?: SchoolFilterChip[];
  onClearAll?: () => void;
  resultSummary?: ReactNode;
  defaultOpen?: boolean;
};

/**
 * Standard school-module filter treatment: keep frequent controls visible,
 * place dimensions in an on-demand panel, and make active filters explicit.
 */
export function SchoolFilterBar({ search, period, children, activeFilters = [], onClearAll, resultSummary, defaultOpen = false }: SchoolFilterBarProps) {
  const [open, setOpen] = useState(defaultOpen);
  return <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
    <div className="flex flex-wrap items-center gap-2">
      {search && <div className="min-w-[15rem] flex-1">{search}</div>}
      {period && <div className="flex min-w-[14rem] flex-1 items-center gap-2">{period}</div>}
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${open ? "border-brand-300 bg-brand-50 text-brand-800" : "border-slate-300 text-slate-700"}`}><Filter className="h-4 w-4" />Filters{activeFilters.length > 0 && <span className="rounded-full bg-brand-700 px-1.5 py-0.5 text-xs leading-none text-white">{activeFilters.length}</span>}</button>
    </div>
    {open && <div className="mt-3 border-t border-slate-100 pt-3">{children}</div>}
    {(activeFilters.length > 0 || resultSummary) && <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
      {resultSummary && <span className="mr-1 text-xs text-slate-500">{resultSummary}</span>}
      {activeFilters.map((filter) => <button type="button" key={filter.key} onClick={filter.onRemove} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-800 hover:bg-brand-100" title={`Remove ${filter.label}`}>{filter.label}<X className="h-3 w-3" /></button>)}
      {activeFilters.length > 0 && onClearAll && <button type="button" onClick={onClearAll} className="ml-1 text-xs font-semibold text-slate-600 hover:text-slate-900">Clear all</button>}
    </div>}
  </div>;
}
