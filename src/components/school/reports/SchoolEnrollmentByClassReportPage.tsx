import { useCallback, useEffect, useMemo, useState } from "react";
import { Columns3, Download, Search, X } from "lucide-react";
import { jsPDF } from "jspdf";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";

type ClassOpt = { id: string; name: string };
type StudentRow = { id: string; admission_number: string; first_name: string; last_name: string; class_id: string | null; class_name: string | null; stream: string | null; gender: string | null; is_boarding: boolean; status: string };
type Dimension = "class" | "stream" | "gender" | "residency";
type Filters = Record<Dimension, string>;
type ColumnKey = "admission" | "name" | "class" | "stream" | "gender" | "residency";
type Props = { readOnly?: boolean };

const DIMENSIONS: Array<{ key: Dimension; label: string }> = [
  { key: "class", label: "Class" }, { key: "stream", label: "Stream" },
  { key: "gender", label: "Gender" }, { key: "residency", label: "Day / Boarding" },
];
const COLUMN_LABELS: Record<ColumnKey, string> = { admission: "Admission no.", name: "Student", class: "Class", stream: "Stream", gender: "Gender", residency: "Day / Boarding" };

function valueFor(student: StudentRow, dimension: Dimension, classNames: Map<string, string>) {
  if (dimension === "class") return (student.class_id && classNames.get(student.class_id)) || student.class_name?.trim() || "Unassigned";
  if (dimension === "stream") return student.stream?.trim() || "Unassigned";
  if (dimension === "gender") return student.gender?.trim() || "Not recorded";
  return student.is_boarding ? "Boarding" : "Day";
}

export function SchoolEnrollmentByClassReportPage({ readOnly: _readOnly }: Props) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const [classes, setClasses] = useState<ClassOpt[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({ class: "", stream: "", gender: "", residency: "" });
  const [search, setSearch] = useState("");
  const [drill, setDrill] = useState<{ dimension: Dimension; value: string } | null>(null);
  const [showColumns, setShowColumns] = useState(false);
  const [columns, setColumns] = useState<Record<ColumnKey, boolean>>({ admission: true, name: true, class: true, stream: true, gender: true, residency: true });

  const load = useCallback(async () => {
    setLoading(true);
    if (!orgId) { setLoading(false); return; }
    const [cRes, sRes] = await Promise.all([
      supabase.from("classes").select("id,name").eq("organization_id", orgId).eq("is_active", true).order("sort_order"),
      supabase.from("students").select("id,admission_number,first_name,last_name,class_id,class_name,stream,gender,is_boarding,status").eq("organization_id", orgId),
    ]);
    setErr(cRes.error?.message || sRes.error?.message || null);
    setClasses((cRes.data as ClassOpt[]) || []);
    setStudents(((sRes.data as StudentRow[]) || []).filter((student) => student.status === "active"));
    setLoading(false);
  }, [orgId]);
  useEffect(() => { void load(); }, [load]);

  const classNames = useMemo(() => new Map(classes.map((item) => [item.id, item.name])), [classes]);
  const options = useMemo(() => Object.fromEntries(DIMENSIONS.map(({ key }) => [key, Array.from(new Set(students.map((student) => valueFor(student, key, classNames)))).sort()])) as Record<Dimension, string[]>, [students, classNames]);
  const filtered = useMemo(() => students.filter((student) => {
    const matchesFilters = DIMENSIONS.every(({ key }) => !filters[key] || valueFor(student, key, classNames) === filters[key]);
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || `${student.admission_number} ${student.first_name} ${student.last_name}`.toLowerCase().includes(query);
    return matchesFilters && matchesSearch && (!drill || valueFor(student, drill.dimension, classNames) === drill.value);
  }), [students, filters, search, drill, classNames]);
  const breakdowns = useMemo(() => Object.fromEntries(DIMENSIONS.map(({ key }) => {
    const counts = new Map<string, number>();
    students.filter((student) => DIMENSIONS.every(({ key: filterKey }) => filterKey === key || !filters[filterKey] || valueFor(student, filterKey, classNames) === filters[filterKey])).forEach((student) => {
      const value = valueFor(student, key, classNames); counts.set(value, (counts.get(value) || 0) + 1);
    });
    return [key, Array.from(counts, ([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))];
  })) as Record<Dimension, Array<{ label: string; count: number }>>, [students, filters, classNames]);

  const setFilter = (dimension: Dimension, value: string) => { setFilters((current) => ({ ...current, [dimension]: value })); setDrill(null); };
  const clearAll = () => { setFilters({ class: "", stream: "", gender: "", residency: "" }); setSearch(""); setDrill(null); };
  const visibleColumnCount = Math.max(1, Object.values(columns).filter(Boolean).length);
  const exportCsv = () => {
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const lines = filtered.map((student) => [student.admission_number, `${student.first_name} ${student.last_name}`, valueFor(student, "class", classNames), valueFor(student, "stream", classNames), valueFor(student, "gender", classNames), valueFor(student, "residency", classNames)].map(escape).join(","));
    const url = URL.createObjectURL(new Blob([["admission_number,student,class,stream,gender,day_boarding", ...lines].join("\n")], { type: "text/csv;charset=utf-8;" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "school_student_statistics.csv"; anchor.click(); URL.revokeObjectURL(url);
  };
  const exportPdf = () => {
    const doc = new jsPDF(); doc.setFontSize(14); doc.text("Student enrollment statistics", 14, 18); doc.setFontSize(9); doc.text(`Active students in current view: ${filtered.length}`, 14, 26); let y = 35;
    DIMENSIONS.forEach(({ key, label }) => { doc.setFont("helvetica", "bold"); doc.text(label, 14, y); y += 5; doc.setFont("helvetica", "normal"); breakdowns[key].forEach((row) => { if (y > 282) { doc.addPage(); y = 15; } doc.text(`${row.label}: ${row.count}`, 18, y); y += 5; }); y += 3; });
    doc.save("school_student_statistics.pdf");
  };

  return <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2"><div><h1 className="text-2xl font-bold text-slate-900">Student statistics</h1><p className="text-sm text-slate-500">Explore active enrollment by class, stream, gender and residence.</p></div><PageNotes ariaLabel="Student statistics"><p>Filters work together. Select any statistic to drill down to the matching students.</p></PageNotes></div>
      <div className="flex gap-2"><button type="button" onClick={exportPdf} className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"><Download className="h-4 w-4" />PDF</button><button type="button" onClick={exportCsv} className="flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800"><Download className="h-4 w-4" />CSV</button></div>
    </div>
    {err && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</p>}
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <label className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400"/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search student or admission no." className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm" /></label>
        {DIMENSIONS.map(({ key, label }) => <select key={key} value={filters[key]} onChange={(event) => setFilter(key, event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">All {label.toLowerCase()}</option>{options[key].map((value) => <option key={value}>{value}</option>)}</select>)}
      </div>
      {(search || drill || Object.values(filters).some(Boolean)) && <div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className="font-semibold text-slate-500">Current view: {filtered.length} students</span>{drill && <button type="button" onClick={() => setDrill(null)} className="flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-1 text-indigo-700">{drill.value}<X className="h-3 w-3"/></button>}<button type="button" onClick={clearAll} className="text-slate-600 underline">Clear all</button></div>}
    </section>
    <div className="grid gap-4 lg:grid-cols-2">
      {DIMENSIONS.map(({ key, label }) => <section key={key} className="rounded-xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><h2 className="font-semibold text-slate-900">By {label.toLowerCase()}</h2><span className="text-xs text-slate-500">Click to drill down</span></div><div className="divide-y divide-slate-100">{loading ? <p className="p-4 text-sm text-slate-500">Loading…</p> : breakdowns[key].length === 0 ? <p className="p-4 text-sm text-slate-500">No active students.</p> : breakdowns[key].map((row) => <button type="button" key={row.label} onClick={() => setDrill({ dimension: key, value: row.label })} className={`flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-indigo-50 ${drill?.dimension === key && drill.value === row.label ? "bg-indigo-50" : ""}`}><span className="min-w-0 flex-1 truncate text-sm text-slate-700">{row.label}</span><span className="font-semibold tabular-nums text-slate-900">{row.count}</span><span className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-indigo-500" style={{ width: `${students.length ? Math.max(3, row.count / students.length * 100) : 0}%` }}/></span></button>)}</div></section>)}
    </div>
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3"><div><h2 className="font-semibold text-slate-900">Student drill-down</h2><p className="text-xs text-slate-500">{filtered.length} active student{filtered.length === 1 ? "" : "s"} in this view</p></div><div className="relative"><button type="button" onClick={() => setShowColumns((open) => !open)} className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"><Columns3 className="h-4 w-4"/>Columns</button>{showColumns && <div className="absolute right-0 z-10 mt-2 w-48 rounded-lg border border-slate-200 bg-white p-2 shadow-xl">{(Object.keys(COLUMN_LABELS) as ColumnKey[]).map((key) => <label key={key} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50"><input type="checkbox" checked={columns[key]} onChange={(event) => setColumns((current) => ({ ...current, [key]: event.target.checked }))}/>{COLUMN_LABELS[key]}</label>)}</div>}</div></div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-slate-600"><tr>{(Object.keys(COLUMN_LABELS) as ColumnKey[]).filter((key) => columns[key]).map((key) => <th key={key} className="whitespace-nowrap px-4 py-3 font-semibold">{COLUMN_LABELS[key]}</th>)}</tr></thead><tbody>{loading ? <tr><td colSpan={visibleColumnCount} className="p-6 text-slate-500">Loading…</td></tr> : filtered.length === 0 ? <tr><td colSpan={visibleColumnCount} className="p-6 text-slate-500">No students match the selected filters.</td></tr> : filtered.map((student) => <tr key={student.id} className="border-t border-slate-100 hover:bg-slate-50">{columns.admission && <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-700">{student.admission_number}</td>}{columns.name && <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">{student.first_name} {student.last_name}</td>}{columns.class && <td className="whitespace-nowrap px-4 py-3">{valueFor(student, "class", classNames)}</td>}{columns.stream && <td className="whitespace-nowrap px-4 py-3">{valueFor(student, "stream", classNames)}</td>}{columns.gender && <td className="whitespace-nowrap px-4 py-3">{valueFor(student, "gender", classNames)}</td>}{columns.residency && <td className="whitespace-nowrap px-4 py-3">{valueFor(student, "residency", classNames)}</td>}</tr>)}</tbody></table></div>
    </section>
  </div>;
}
