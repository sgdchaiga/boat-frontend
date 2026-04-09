import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Wallet } from "lucide-react";
import { jsPDF } from "jspdf";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useAppContext } from "@/contexts/AppContext";
import { PageNotes } from "@/components/common/PageNotes";
import { SCHOOL_PAGE } from "@/lib/schoolPages";

type InvRow = {
  id: string;
  invoice_number: string;
  academic_year: string;
  term_name: string;
  total_due: number;
  amount_paid: number;
  status: string;
  student_id: string;
};

type StudentOpt = {
  id: string;
  first_name: string;
  last_name: string;
  admission_number: string;
  class_name: string;
  class_id: string | null;
};

type Props = { readOnly?: boolean };

export function SchoolOutstandingBalancesReportPage({ readOnly: _readOnly }: Props) {
  const { user } = useAuth();
  const { setCurrentPage } = useAppContext();
  const orgId = user?.organization_id;
  const [rawRows, setRawRows] = useState<(InvRow & { balance: number; student?: StudentOpt })[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [termFilter, setTermFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    if (!orgId) {
      setLoading(false);
      return;
    }
    const [iRes, sRes] = await Promise.all([
      supabase
        .from("student_invoices")
        .select("id,invoice_number,academic_year,term_name,total_due,amount_paid,status,student_id")
        .eq("organization_id", orgId)
        .neq("status", "cancelled"),
      supabase.from("students").select("id,first_name,last_name,admission_number,class_name,class_id").eq("organization_id", orgId),
    ]);
    setErr(iRes.error?.message || sRes.error?.message || null);
    const invs = (iRes.data as InvRow[]) || [];
    const studs = (sRes.data as StudentOpt[]) || [];
    const map = new Map(studs.map((s) => [s.id, s]));

    const list = invs
      .map((inv) => {
        const balance = Number(inv.total_due ?? 0) - Number(inv.amount_paid ?? 0);
        return { ...inv, balance, student: map.get(inv.student_id) };
      })
      .filter((r) => r.balance > 0.005);

    list.sort((a, b) => b.balance - a.balance);
    setRawRows(list);
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    if (!termFilter.trim()) return rawRows;
    const q = termFilter.trim().toLowerCase();
    return rawRows.filter((r) => `${r.academic_year} ${r.term_name}`.toLowerCase().includes(q));
  }, [rawRows, termFilter]);

  const totalOutstanding = useMemo(() => rows.reduce((s, r) => s + r.balance, 0), [rows]);

  const studentLabel = (r: (typeof rows)[0]) => {
    const s = r.student;
    if (!s) return r.student_id.slice(0, 8);
    return `${s.admission_number} — ${s.first_name} ${s.last_name}`;
  };

  const exportCsv = () => {
    const header = ["invoice", "student", "class", "term", "year", "total_due", "paid", "balance", "status"];
    const lines = rows.map((r) =>
      [
        r.invoice_number,
        studentLabel(r),
        r.student?.class_name ?? "",
        r.term_name,
        r.academic_year,
        r.total_due,
        r.amount_paid,
        r.balance,
        r.status,
      ]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "school_outstanding_balances.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text("Outstanding fee balances", 14, 18);
    doc.setFontSize(9);
    doc.text(`Invoices: ${rows.length} · Total outstanding: ${totalOutstanding.toFixed(2)}`, 14, 26);
    let y = 36;
    doc.setFontSize(7);
    rows.slice(0, 35).forEach((r) => {
      const line = `${r.invoice_number} ${studentLabel(r)} ${r.balance.toFixed(2)}`;
      doc.text(line.substring(0, 120), 14, y);
      y += 3.5;
    });
    if (rows.length > 35) doc.text(`… ${rows.length - 35} more (export CSV).`, 14, y);
    doc.save("school_outstanding_balances.pdf");
  };

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900">School Defaulters</h1>
          <PageNotes ariaLabel="Outstanding">
            <p>Non-cancelled student invoices where amount paid is below total due.</p>
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

      <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap gap-4 items-end">
        <label className="flex flex-col gap-1 text-xs text-slate-600 flex-1 min-w-[200px]">
          Filter by year / term (contains)
          <input
            type="text"
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="e.g. 2025 or Term 1"
            value={termFilter}
            onChange={(e) => setTermFilter(e.target.value)}
          />
        </label>
        <p className="text-sm text-slate-700 pb-2">
          <span className="text-slate-500">Total outstanding:</span>{" "}
          <span className="font-semibold text-slate-900">{totalOutstanding.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left p-3 font-semibold text-slate-700">Invoice</th>
              <th className="text-left p-3 font-semibold text-slate-700">Student</th>
              <th className="text-left p-3 font-semibold text-slate-700">Class</th>
              <th className="text-left p-3 font-semibold text-slate-700">Term</th>
              <th className="text-right p-3 font-semibold text-slate-700">Due</th>
              <th className="text-right p-3 font-semibold text-slate-700">Paid</th>
              <th className="text-right p-3 font-semibold text-slate-700">Balance</th>
              <th className="text-left p-3 font-semibold text-slate-700">Status</th>
              <th className="text-right p-3 font-semibold text-slate-700 whitespace-nowrap">Pay fees</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="p-6 text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-6 text-slate-500">
                  No outstanding balances.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                  <td className="p-3 font-mono text-slate-800">{r.invoice_number}</td>
                  <td className="p-3 text-slate-700">{studentLabel(r)}</td>
                  <td className="p-3 text-slate-600">{r.student?.class_name?.trim() || "—"}</td>
                  <td className="p-3 text-slate-700">
                    {r.academic_year} · {r.term_name}
                  </td>
                  <td className="p-3 text-right">{Number(r.total_due).toLocaleString()}</td>
                  <td className="p-3 text-right text-slate-600">{Number(r.amount_paid).toLocaleString()}</td>
                  <td className="p-3 text-right font-medium text-amber-900">{r.balance.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                  <td className="p-3 capitalize text-slate-600">{r.status}</td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() =>
                        setCurrentPage(SCHOOL_PAGE.payments, {
                          schoolFeeStudentId: r.student_id,
                          schoolFeeInvoiceId: r.id,
                        })
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-teal-600 bg-teal-50 text-teal-900 text-sm font-medium hover:bg-teal-100"
                    >
                      <Wallet className="w-4 h-4 shrink-0" aria-hidden />
                      Pay fees
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
