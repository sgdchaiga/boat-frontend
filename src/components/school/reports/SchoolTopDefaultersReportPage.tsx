import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Download, Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";
import { fetchAllPages } from "@/lib/supabasePagination";
import { useAppContext } from "@/contexts/AppContext";
import { SCHOOL_PAGE } from "@/lib/schoolPages";

type Row = {
  student_id: string;
  balance: number;
  admission_number: string;
  school_pay_number?: string | null;
  first_name: string;
  last_name: string;
  class_name: string;
};

type StudentBrief = {
  id: string;
  admission_number: string;
  school_pay_number?: string | null;
  first_name: string;
  last_name: string;
  class_name: string;
};

type Props = { readOnly?: boolean };

export function SchoolTopDefaultersReportPage({ readOnly: _readOnly }: Props) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const { setCurrentPage } = useAppContext();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [limit, setLimit] = useState(25);
  const [studentStatus, setStudentStatus] = useState<"all" | "active" | "inactive">("all");
  const [year, setYear] = useState("");
  const [term, setTerm] = useState("");

  const load = useCallback(async () => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let invData: { student_id: string; total_due?: number; amount_paid?: number; academic_year: string; term_name: string }[];
    try { invData = await fetchAllPages((start, end) => { let q = supabase.from("student_invoices").select("student_id,total_due,amount_paid,academic_year,term_name").eq("organization_id", orgId).neq("status", "cancelled").range(start, end); if (year) q = q.eq("academic_year", year); if (term) q = q.eq("term_name", term); return q; }); }
    catch (error) { setErr(error instanceof Error ? error.message : "Failed to load invoices."); setLoading(false); return; }

    const byStudent = new Map<string, number>();
    for (const inv of invData || []) {
      const r = inv as { student_id: string; total_due?: number; amount_paid?: number };
      const due = Math.max(0, Number(r.total_due ?? 0) - Number(r.amount_paid ?? 0));
      byStudent.set(r.student_id, (byStudent.get(r.student_id) || 0) + due);
    }

    let studData: StudentBrief[];
    try { studData = await fetchAllPages((start, end) => {
      let q = supabase.from("students").select("id,admission_number,school_pay_number,first_name,last_name,class_name,status").eq("organization_id", orgId).range(start, end);
      if (studentStatus !== "all") q = q.eq("status", studentStatus);
      return q;
    }) as StudentBrief[]; setErr(null); }
    catch (error) { setErr(error instanceof Error ? error.message : "Failed to load students."); setLoading(false); return; }
    const studs = new Map<string, StudentBrief>(
      (studData || []).map((s) => {
        const r = s as StudentBrief;
        return [r.id, r];
      })
    );

    const list: Row[] = [];
    for (const [id, balance] of byStudent.entries()) {
      if (balance <= 0) continue;
      const s = studs.get(id);
      if (!s) continue;
      list.push({
        student_id: id,
        balance,
        admission_number: s.admission_number,
        school_pay_number: s.school_pay_number,
        first_name: s.first_name,
        last_name: s.last_name,
        class_name: s.class_name,
      });
    }
    list.sort((a, b) => b.balance - a.balance);
    setRows(list.slice(0, limit));
    setLoading(false);
  }, [orgId, limit, studentStatus, year, term]);

  useEffect(() => {
    load();
  }, [load]);

  if (!orgId) {
    return <p className="p-6 text-slate-600">Select an organization.</p>;
  }
  const exportCsv = () => {
    const csv = [["admission_number", "student", "school_pay_number", "class", "outstanding"], ...rows.map((r) => [r.admission_number, `${r.first_name} ${r.last_name}`, r.school_pay_number || "", r.class_name, r.balance])].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const a = document.createElement("a"); a.href = url; a.download = "school_top_defaulters.csv"; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] p-6 md:p-8 bg-gradient-to-br from-slate-50 to-amber-50/20">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <h1 className="text-2xl font-bold text-slate-900">Top defaulters</h1>
        <PageNotes ariaLabel="Defaulters">
          <p>Students with the highest outstanding fee balance (non-cancelled invoices), sorted by amount due.</p>
        </PageNotes>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <label className="text-sm text-slate-600">Show top</label>
        <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="border rounded-lg px-2 py-1.5 text-sm">
          <option value={10}>10</option>
          <option value={25}>25</option>
          <option value={50}>50</option>
        </select>
        <label className="text-sm text-slate-600">Students</label><select value={studentStatus} onChange={(e) => setStudentStatus(e.target.value as typeof studentStatus)} className="border rounded-lg px-2 py-1.5 text-sm"><option value="all">All debtors</option><option value="active">Active only</option><option value="inactive">Inactive only</option></select><input value={year} onChange={(e) => setYear(e.target.value)} placeholder="Academic year" className="border rounded-lg px-2 py-1.5 text-sm" aria-label="Academic year" /><input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Term" className="border rounded-lg px-2 py-1.5 text-sm" aria-label="Term" />
        <button type="button" onClick={exportCsv} disabled={loading} className="app-btn-secondary"><Download className="w-4 h-4" /> CSV</button>
      </div>

      {err && <p className="text-red-600 text-sm mb-4">{err}</p>}

      {loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left p-2">#</th>
                <th className="text-left p-2">Student</th>
                <th className="text-left p-2">SchoolPay code</th>
                <th className="text-left p-2">Class</th>
                <th className="text-right p-2">Outstanding</th>
                <th className="text-right p-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.student_id} className="border-b border-slate-100">
                  <td className="p-2 text-slate-500">{i + 1}</td>
                  <td className="p-2">
                    <div className="font-medium">
                      {r.first_name} {r.last_name}
                    </div>
                    <div className="text-xs text-slate-500 font-mono">{r.admission_number}</div>
                  </td>
                  <td className="p-2 font-mono">{r.school_pay_number || "—"}</td>
                  <td className="p-2">{r.class_name}</td>
                  <td className="p-2 text-right font-semibold text-amber-800 tabular-nums">{r.balance.toFixed(2)}</td>
                  <td className="p-2 text-right"><button type="button" onClick={() => setCurrentPage(SCHOOL_PAGE.payments, { schoolFeeStudentId: r.student_id })} className="inline-flex items-center gap-1 text-sm text-teal-800"><Wallet className="w-4 h-4" /> Pay</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="p-8 text-center text-slate-500 flex flex-col items-center gap-2">
              <AlertTriangle className="w-8 h-8 text-emerald-500" />
              No outstanding balances — all caught up.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
