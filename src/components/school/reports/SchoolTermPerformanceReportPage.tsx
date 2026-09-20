import { useCallback, useEffect, useState } from "react";
import { BookOpen, Download } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";
import { fetchAllPages } from "@/lib/supabasePagination";

type Row = {
  academic_year: string;
  term_name: string;
  invoice_count: number;
  invoiced: number;
  collected: number;
  outstanding: number;
};

type Props = { readOnly?: boolean };

export function SchoolTermPerformanceReportPage({ readOnly: _readOnly }: Props) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [year, setYear] = useState("");
  const [term, setTerm] = useState("");

  const load = useCallback(async () => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let data: { academic_year: string; term_name: string; total_due?: number; amount_paid?: number }[];
    try { data = await fetchAllPages((start, end) => supabase.from("student_invoices").select("academic_year,term_name,total_due,amount_paid").eq("organization_id", orgId).neq("status", "cancelled").range(start, end)); setErr(null); }
    catch (error) { setErr(error instanceof Error ? error.message : "Failed to load term performance."); setRows([]); setLoading(false); return; }
    const map = new Map<string, Row>();
    for (const inv of data || []) {
      const r = inv as {
        academic_year: string;
        term_name: string;
        total_due?: number;
        amount_paid?: number;
      };
      const key = `${r.academic_year}||${r.term_name}`;
      const cur = map.get(key) || {
        academic_year: r.academic_year,
        term_name: r.term_name,
        invoice_count: 0,
        invoiced: 0,
        collected: 0,
        outstanding: 0,
      };
      cur.invoice_count += 1;
      const due = Number(r.total_due ?? 0);
      const paid = Number(r.amount_paid ?? 0);
      cur.invoiced += due;
      cur.collected += paid;
      cur.outstanding += Math.max(0, due - paid);
      map.set(key, cur);
    }
    const list = [...map.values()].sort((a, b) => {
      if (a.academic_year !== b.academic_year) return b.academic_year.localeCompare(a.academic_year);
      return a.term_name.localeCompare(b.term_name);
    });
    setRows(list);
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!orgId) {
    return <p className="p-6 text-slate-600">Select an organization.</p>;
  }
  const years = [...new Set(rows.map((row) => row.academic_year))].sort().reverse();
  const terms = [...new Set(rows.map((row) => row.term_name))].sort();
  const visibleRows = rows.filter((row) => (!year || row.academic_year === year) && (!term || row.term_name === term));
  const exportCsv = () => {
    const csv = [["academic_year", "term", "invoices", "invoiced", "collected", "outstanding", "collection_percent"], ...visibleRows.map((r) => [r.academic_year, r.term_name, r.invoice_count, r.invoiced, r.collected, r.outstanding, r.invoiced ? (r.collected / r.invoiced * 100).toFixed(1) : "0.0"])].map((row) => row.join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const a = document.createElement("a"); a.href = url; a.download = "school_term_performance.csv"; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] p-6 md:p-8 bg-gradient-to-br from-slate-50 to-indigo-50/20">
      <div className="flex items-center gap-2 mb-2">
        <h1 className="text-2xl font-bold text-slate-900">Term performance summaries</h1>
        <PageNotes ariaLabel="Term performance">
          <p>
            Aggregates student invoices by academic year and term: amounts invoiced, collected, and still outstanding. Academic performance is not stored in
            this module; use this for <strong>fee billing</strong> health per term.
          </p>
        </PageNotes>
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-2"><p className="text-sm text-slate-600 flex items-center gap-2">
        <BookOpen className="w-4 h-4" /> Based on invoice academic year / term fields.
      </p><select value={year} onChange={(e) => setYear(e.target.value)} className="rounded-lg border px-3 py-2 text-sm"><option value="">All years</option>{years.map((value) => <option key={value}>{value}</option>)}</select><select value={term} onChange={(e) => setTerm(e.target.value)} className="rounded-lg border px-3 py-2 text-sm"><option value="">All terms</option>{terms.map((value) => <option key={value}>{value}</option>)}</select><button type="button" onClick={exportCsv} disabled={loading} className="app-btn-secondary"><Download className="w-4 h-4" /> CSV</button></div>

      {err && <p className="text-red-600 text-sm mb-4">{err}</p>}

      {loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left p-2">Academic year</th>
                <th className="text-left p-2">Term</th>
                <th className="text-right p-2">Invoices</th>
                <th className="text-right p-2">Invoiced</th>
                <th className="text-right p-2">Collected</th>
                <th className="text-right p-2">Outstanding</th>
                <th className="text-right p-2">Collection %</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => {
                const pct = r.invoiced > 0 ? (r.collected / r.invoiced) * 100 : 0;
                return (
                  <tr key={`${r.academic_year}-${r.term_name}`} className="border-b border-slate-100">
                    <td className="p-2 font-medium">{r.academic_year}</td>
                    <td className="p-2">{r.term_name}</td>
                    <td className="p-2 text-right tabular-nums">{r.invoice_count}</td>
                    <td className="p-2 text-right tabular-nums">{r.invoiced.toFixed(2)}</td>
                    <td className="p-2 text-right tabular-nums text-emerald-700">{r.collected.toFixed(2)}</td>
                    <td className="p-2 text-right tabular-nums text-amber-800">{r.outstanding.toFixed(2)}</td>
                    <td className="p-2 text-right tabular-nums font-medium">{pct.toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {visibleRows.length === 0 && <p className="p-6 text-slate-500 text-sm">No invoice data matches the selected filters.</p>}
        </div>
      )}
    </div>
  );
}
