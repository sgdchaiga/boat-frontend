import { useMemo, useState } from "react";
import { SchoolFilterBar, type SchoolFilterChip } from "../common/SchoolFilterBar";

type Student = { id: string; first_name: string; last_name: string; admission_number: string; school_pay_number?: string | null; class_id: string | null; class_name: string; is_boarding?: boolean | null };
type Invoice = { student_id: string; invoice_number: string; academic_year: string; term_name: string; status: string; issue_date?: string | null };
const emptyFilters = { residency: "", search: "", student: "", className: "", chargeType: "", year: "", term: "", status: "", from: "", to: "" };

export function useSchoolInvoiceFilters<T extends Invoice>(rows: T[], students: Student[], optionsConfig: { showResidency?: boolean; getChargeTypes?: (invoice: T) => string[]; hideCancelledByDefault?: boolean } = {}) {
  const [filters, setFilters] = useState(emptyFilters);
  const [showCancelled, setShowCancelled] = useState(!optionsConfig.hideCancelledByDefault);
  const studentMap = useMemo(() => new Map(students.map((student) => [student.id, student])), [students]);
  const filteredRows = useMemo(() => rows.filter((row) => {
    const student = studentMap.get(row.student_id);
    const search = filters.search.trim().toLowerCase();
    const date = row.issue_date?.slice(0, 10);
    return (!search || `${row.invoice_number} ${student?.first_name ?? ""} ${student?.last_name ?? ""} ${student?.admission_number ?? ""} ${student?.school_pay_number ?? ""}`.toLowerCase().includes(search))
      && (showCancelled || filters.status === "cancelled" || row.status !== "cancelled")
      && (!filters.residency || (filters.residency === "boarding" ? student?.is_boarding === true : student?.is_boarding === false))
      && (!filters.student || row.student_id === filters.student)
      && (!filters.className || student?.class_name?.trim() === filters.className)
      && (!filters.chargeType || (optionsConfig.getChargeTypes?.(row) || []).includes(filters.chargeType))
      && (!filters.year || row.academic_year === filters.year)
      && (!filters.term || row.term_name === filters.term)
      && (!filters.status || row.status === filters.status)
      && (!filters.from || (!!date && date >= filters.from))
      && (!filters.to || (!!date && date <= filters.to));
  }), [rows, studentMap, filters, showCancelled]);
  const options = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const controlClass = "border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white w-full";
  const select = (label: string, key: keyof typeof filters, values: { value: string; label: string }[]) => (
    <label className="text-xs text-slate-600 space-y-1">
      <span>{label}</span>
      <select className={controlClass} value={filters[key]} onChange={(event) => setFilters((current) => ({ ...current, [key]: event.target.value }))}>
        <option value="">All {label.toLowerCase()}</option>
        {values.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
  const simpleOptions = (values: string[]) => options(values).map((value) => ({ value, label: value }));
  const activeFilters = Object.entries(filters).flatMap(([key, value]) => value ? [{ key, label: `${({ residency: "Residency", student: "Student", className: "Class", chargeType: "Charge", year: "Year", term: "Term", status: "Status", from: "From", to: "To", search: "Search" } as Record<string, string>)[key]}: ${key === "student" ? students.find((student) => student.id === value)?.first_name || value : value}`, onRemove: () => setFilters((current) => ({ ...current, [key]: "" })) }] : []) as SchoolFilterChip[];
  const controls = (
    <SchoolFilterBar
      search={<input className={controlClass} aria-label="Search student or invoice" placeholder="Search student, admission, SchoolPay or invoice" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} />}
      period={<><input type="date" aria-label="Issue date from" className={controlClass} value={filters.from} max={filters.to || undefined} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} /><span className="text-sm text-slate-400">to</span><input type="date" aria-label="Issue date to" className={controlClass} value={filters.to} min={filters.from || undefined} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} /></>}
      activeFilters={activeFilters}
      onClearAll={() => { setFilters(emptyFilters); setShowCancelled(!optionsConfig.hideCancelledByDefault); }}
      resultSummary={<>{filteredRows.length} of {rows.length} invoices</>}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {select("Students", "student", students.map((student) => ({ value: student.id, label: `${student.first_name} ${student.last_name}` })).sort((a, b) => a.label.localeCompare(b.label)))}
        {optionsConfig.showResidency && select("Day/Boarding", "residency", [{ value: "day", label: "Day" }, { value: "boarding", label: "Boarding" }])}
        {select("Classes", "className", simpleOptions(students.map((student) => student.class_name?.trim() || "")))}
        {optionsConfig.getChargeTypes && select("Charge type", "chargeType", simpleOptions(rows.flatMap((row) => optionsConfig.getChargeTypes?.(row) || [])))}
        {select("Academic years", "year", simpleOptions(rows.map((row) => row.academic_year)))}
        {select("Terms", "term", simpleOptions(rows.map((row) => row.term_name)))}
        {select("Statuses", "status", simpleOptions(rows.map((row) => row.status)))}
      </div>
      <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={showCancelled} onChange={(event) => setShowCancelled(event.target.checked)} /> Show cancelled invoices</label>
      {filters.from && filters.to && filters.from > filters.to && <p role="alert" className="text-sm text-red-600">The end date must be on or after the start date.</p>}
    </SchoolFilterBar>
  );
  return { filteredRows, controls };
}
