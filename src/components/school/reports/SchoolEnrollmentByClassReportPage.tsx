import { useCallback, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { jsPDF } from "jspdf";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";

type ClassOpt = { id: string; name: string };
type StudentRow = { id: string; class_id: string | null; class_name: string; status: string };

type ClassAgg = { key: string; label: string; count: number };

type Props = { readOnly?: boolean };

export function SchoolEnrollmentByClassReportPage({ readOnly: _readOnly }: Props) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const [classes, setClasses] = useState<ClassOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [aggs, setAggs] = useState<ClassAgg[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    if (!orgId) {
      setLoading(false);
      return;
    }
    const [cRes, sRes] = await Promise.all([
      supabase.from("classes").select("id,name").eq("organization_id", orgId).eq("is_active", true).order("sort_order"),
      supabase.from("students").select("id,class_id,class_name,status").eq("organization_id", orgId),
    ]);
    setErr(cRes.error?.message || sRes.error?.message || null);
    const clsList = (cRes.data as ClassOpt[]) || [];
    const studs = ((sRes.data as StudentRow[]) || []).filter((s) => s.status === "active");
    setClasses(clsList);

    const nameByClassId = new Map(clsList.map((c) => [c.id, c.name]));

    const map = new Map<string, { label: string; count: number }>();

    for (const s of studs) {
      let label: string;
      let key: string;
      if (s.class_id && nameByClassId.has(s.class_id)) {
        key = `id:${s.class_id}`;
        label = nameByClassId.get(s.class_id)!;
      } else {
        const raw = (s.class_name ?? "").trim();
        if (!raw) {
          key = "unassigned";
          label = "Unassigned";
        } else {
          key = `name:${raw.toLowerCase()}`;
          label = raw;
        }
      }
      const cur = map.get(key) ?? { label, count: 0 };
      cur.count += 1;
      cur.label = label;
      map.set(key, cur);
    }

    const list: ClassAgg[] = Array.from(map.entries())
      .map(([key, v]) => ({ key, label: v.label, count: v.count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    setAggs(list);
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const total = useMemo(() => aggs.reduce((s, a) => s + a.count, 0), [aggs]);

  const exportCsv = () => {
    const header = ["class", "active_students"];
    const lines = aggs.map((a) => `"${a.label.replace(/"/g, '""')}",${a.count}`);
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "school_enrollment_by_class.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text("Enrollment by class (active)", 14, 18);
    doc.setFontSize(9);
    doc.text(`Total active students: ${total}`, 14, 26);
    let y = 36;
    doc.setFontSize(9);
    aggs.forEach((row) => {
      doc.text(`${row.label}: ${row.count}`, 14, y);
      y += 5;
    });
    doc.save("school_enrollment_by_class.pdf");
  };

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900">Enrollment by class</h1>
          <PageNotes ariaLabel="Enrollment">
            <p>Active students grouped by catalog class when linked; otherwise by stored class name. Unassigned means no class name.</p>
          </PageNotes>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={exportPdf} className="px-3 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 flex items-center gap-1">
            <Download className="w-4 h-4" />
            PDF
          </button>
          <button type="button" onClick={exportCsv} className="px-3 py-2 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800 flex items-center gap-1">
            <Download className="w-4 h-4" />
            CSV
          </button>
        </div>
      </div>
      {err && <p className="text-red-600 text-sm">{err}</p>}

      <p className="text-sm text-slate-600">
        Catalog has {classes.length} class{classes.length === 1 ? "" : "es"}. Total active:{" "}
        <span className="font-semibold text-slate-900">{total}</span>
      </p>

      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left p-3 font-semibold text-slate-700">Class</th>
              <th className="text-right p-3 font-semibold text-slate-700">Active students</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={2} className="p-6 text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : aggs.length === 0 ? (
              <tr>
                <td colSpan={2} className="p-6 text-slate-500">
                  No active students.
                </td>
              </tr>
            ) : (
              aggs.map((r) => (
                <tr key={r.key} className="border-b border-slate-100 hover:bg-slate-50/80">
                  <td className="p-3 text-slate-900">{r.label}</td>
                  <td className="p-3 text-right font-medium text-slate-900">{r.count}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
