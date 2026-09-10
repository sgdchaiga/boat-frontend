import { useMemo, useState } from "react";

type Student = { id: string; first_name: string; last_name: string; admission_number: string; class_id: string | null; class_name: string };
type Invoice = { student_id: string; invoice_number: string; academic_year: string; term_name: string; status: string; issue_date?: string | null };
const emptyFilters = { search: "", student: "", className: "", year: "", term: "", status: "", from: "", to: "" };

export function useSchoolInvoiceFilters<T extends Invoice>(rows: T[], students: Student[]) {
  const [filters, setFilters] = useState(emptyFilters);
  const studentMap = useMemo(() => new Map(students.map((student) => [student.id, student])), [students]);
  const filteredRows = useMemo(() => rows.filter((row) => {
    const student = studentMap.get(row.student_id);
    const search = filters.search.trim().toLowerCase();
    const date = row.issue_date?.slice(0, 10);
    return (!search || `${row.invoice_number} ${student?.first_name ?? ""} ${student?.last_name ?? ""} ${student?.admission_number ?? ""}`.toLowerCase().includes(search))
      && (!filters.student || row.student_id === filters.student)
      && (!filters.className || student?.class_name?.trim() === filters.className)
      && (!filters.year || row.academic_year === filters.year)
      && (!filters.term || row.term_name === filters.term)
      && (!filters.status || row.status === filters.status)
      && (!filters.from || (!!date && date >= filters.from))
      && (!filters.to || (!!date && date <= filters.to));
  }), [rows, studentMap, filters]);
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
  const controls = (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <label className="text-xs text-slate-600 space-y-1"><span>Search student / invoice</span><input className={controlClass} placeholder="Name, admission or invoice number" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} /></label>
        {select("Students", "student", students.map((student) => ({ value: student.id, label: `${student.admission_number} — ${student.first_name} ${student.last_name}` })).sort((a, b) => a.label.localeCompare(b.label)))}
        {select("Classes", "className", simpleOptions(students.map((student) => student.class_name?.trim() || "")))}
        {select("Academic years", "year", simpleOptions(rows.map((row) => row.academic_year)))}
        {select("Terms", "term", simpleOptions(rows.map((row) => row.term_name)))}
        {select("Statuses", "status", simpleOptions(rows.map((row) => row.status)))}
        <label className="text-xs text-slate-600 space-y-1"><span>Issue date from</span><input type="date" className={controlClass} value={filters.from} max={filters.to || undefined} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} /></label>
        <label className="text-xs text-slate-600 space-y-1"><span>Issue date to</span><input type="date" className={controlClass} value={filters.to} min={filters.from || undefined} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} /></label>
      </div>
      <div className="flex items-center justify-between gap-3 text-sm text-slate-600"><span>{filteredRows.length} of {rows.length} invoices</span><button type="button" onClick={() => setFilters(emptyFilters)} className="font-medium text-indigo-700">Clear filters</button></div>
      {filters.from && filters.to && filters.from > filters.to && <p role="alert" className="text-sm text-red-600">The end date must be on or after the start date.</p>}
    </div>
  );
  return { filteredRows, controls };
}
