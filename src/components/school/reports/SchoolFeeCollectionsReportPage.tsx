import { useCallback, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { jsPDF } from "jspdf";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";
import { computeReportRange, type DateRangeKey } from "@/lib/reportsDateRange";

type ClassOpt = { id: string; name: string };
type StudentOpt = {
  id: string;
  first_name: string;
  last_name: string;
  admission_number: string;
  class_id: string | null;
  class_name: string;
};

type PayRow = {
  id: string;
  amount: number;
  method: string;
  reference: string | null;
  paid_at: string;
  student_id: string;
};

const METHODS = ["cash", "mobile_money", "bank", "transfer", "other"] as const;
const METHOD_LABEL: Record<(typeof METHODS)[number], string> = {
  cash: "Cash",
  mobile_money: "Mobile money",
  bank: "Bank",
  transfer: "Transfer",
  other: "Other",
};

type Props = { readOnly?: boolean };

export function SchoolFeeCollectionsReportPage({ readOnly: _readOnly }: Props) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const [payments, setPayments] = useState<PayRow[]>([]);
  const [students, setStudents] = useState<StudentOpt[]>([]);
  const [classes, setClasses] = useState<ClassOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRangeKey>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [methodFilter, setMethodFilter] = useState<"" | (typeof METHODS)[number]>("");
  const [studentId, setStudentId] = useState("");
  const [classId, setClassId] = useState("");

  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);

  const studentLabel = (id: string) => {
    const s = studentById.get(id);
    if (!s) return id.slice(0, 8);
    return `${s.admission_number} — ${s.first_name} ${s.last_name}`;
  };

  const classLabelForStudent = (s: StudentOpt | undefined) => {
    if (!s) return "—";
    if (s.class_id) {
      const c = classes.find((x) => x.id === s.class_id);
      if (c) return c.name;
    }
    return s.class_name?.trim() || "—";
  };

  const load = useCallback(async () => {
    setLoading(true);
    if (!orgId) {
      setLoading(false);
      return;
    }
    const { from, to } = computeReportRange(dateRange, customFrom, customTo);
    const fromIso = from.toISOString();
    const toIso = to.toISOString();

    const [sRes, cRes] = await Promise.all([
      supabase
        .from("students")
        .select("id,first_name,last_name,admission_number,class_id,class_name")
        .eq("organization_id", orgId)
        .order("last_name"),
      supabase.from("classes").select("id,name").eq("organization_id", orgId).eq("is_active", true).order("sort_order"),
    ]);
    if (sRes.error || cRes.error) {
      setErr(sRes.error?.message || cRes.error?.message || null);
      setLoading(false);
      return;
    }
    setStudents((sRes.data as StudentOpt[]) || []);
    setClasses((cRes.data as ClassOpt[]) || []);

    let q = supabase
      .from("school_payments")
      .select("id,amount,paid_at,method,reference,student_id")
      .eq("organization_id", orgId)
      .gte("paid_at", fromIso)
      .lt("paid_at", toIso)
      .order("paid_at", { ascending: false });

    if (methodFilter) q = q.eq("method", methodFilter);
    if (studentId) q = q.eq("student_id", studentId);

    const { data, error } = await q;
    setErr(error?.message || null);
    let list = (data as PayRow[]) || [];

    const studs = (sRes.data as StudentOpt[]) || [];
    const clsList = (cRes.data as ClassOpt[]) || [];
    const studMap = new Map(studs.map((s) => [s.id, s]));

    if (classId) {
      const c = clsList.find((x) => x.id === classId);
      const name = c?.name?.trim().toLowerCase() ?? "";
      list = list.filter((p) => {
        const st = studMap.get(p.student_id);
        if (!st) return false;
        if (st.class_id === classId) return true;
        if (name && (st.class_name ?? "").trim().toLowerCase() === name) return true;
        return false;
      });
    }

    setPayments(list);
    setLoading(false);
  }, [orgId, dateRange, customFrom, customTo, methodFilter, studentId, classId]);

  useEffect(() => {
    load();
  }, [load]);

  const totalsByMethod = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of payments) {
      const k = p.method || "other";
      m.set(k, (m.get(k) ?? 0) + Number(p.amount ?? 0));
    }
    return m;
  }, [payments]);

  const grandTotal = useMemo(() => payments.reduce((a, p) => a + Number(p.amount ?? 0), 0), [payments]);

  const methodLabel = (m: string) =>
    METHODS.includes(m as (typeof METHODS)[number]) ? METHOD_LABEL[m as (typeof METHODS)[number]] : m;

  const exportPdf = () => {
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text("Fee collections report", 14, 18);
    doc.setFontSize(9);
    doc.text(`Payments: ${payments.length} · Total: ${grandTotal.toFixed(2)}`, 14, 26);
    let y = 38;
    doc.setFontSize(8);
    payments.slice(0, 40).forEach((r) => {
      const paid = r.paid_at ? new Date(r.paid_at).toLocaleString() : "";
      const line = `${paid} ${studentLabel(r.student_id)} ${methodLabel(r.method)} ${Number(r.amount).toFixed(2)}`;
      doc.text(line.substring(0, 120), 14, y);
      y += 4;
    });
    if (payments.length > 40) doc.text(`… and ${payments.length - 40} more rows (export CSV for full list).`, 14, y);
    doc.save("school_fee_collections_report.pdf");
  };

  const exportCsv = () => {
    const header = ["paid_at", "student", "class", "method", "amount", "reference"];
    const rows = payments.map((r) => {
      const st = studentById.get(r.student_id);
      return [
        r.paid_at,
        studentLabel(r.student_id),
        classLabelForStudent(st),
        methodLabel(r.method),
        String(r.amount),
        r.reference ?? "",
      ];
    });
    const csv = [header.join(","), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "school_fee_collections.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900">Fee collections report</h1>
          <PageNotes ariaLabel="Fee collections report">
            <p>School fee payments in the selected period, with optional filters. Export PDF (sample) or CSV (full).</p>
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

      <div className="rounded-xl border border-slate-200 bg-white p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Period
          <select
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value as DateRangeKey)}
          >
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="this_week">This week</option>
            <option value="this_month">This month</option>
            <option value="this_quarter">This quarter</option>
            <option value="this_year">This year</option>
            <option value="last_week">Last week</option>
            <option value="last_month">Last month</option>
            <option value="last_quarter">Last quarter</option>
            <option value="last_year">Last year</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        {dateRange === "custom" && (
          <>
            <label className="flex flex-col gap-1 text-xs text-slate-600">
              From
              <input type="date" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-600">
              To
              <input type="date" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </label>
          </>
        )}
        <select
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm self-end"
          value={methodFilter}
          onChange={(e) => setMethodFilter(e.target.value as typeof methodFilter)}
        >
          <option value="">All methods</option>
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {METHOD_LABEL[m]}
            </option>
          ))}
        </select>
        <select
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
        >
          <option value="">All students</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.admission_number} — {s.first_name} {s.last_name}
            </option>
          ))}
        </select>
        <select className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">All classes</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 flex flex-wrap gap-6 text-sm">
        <span>
          <span className="text-slate-500">Count: </span>
          <span className="font-semibold">{payments.length}</span>
        </span>
        <span>
          <span className="text-slate-500">Total: </span>
          <span className="font-semibold">{grandTotal.toLocaleString()}</span>
        </span>
        {METHODS.map((m) => {
          const v = totalsByMethod.get(m) ?? 0;
          if (v === 0) return null;
          return (
            <span key={m} className="text-slate-700">
              <span className="text-slate-500">{METHOD_LABEL[m]}:</span> {v.toLocaleString()}
            </span>
          );
        })}
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left p-3 font-semibold text-slate-700">Paid at</th>
              <th className="text-left p-3 font-semibold text-slate-700">Student</th>
              <th className="text-left p-3 font-semibold text-slate-700">Class</th>
              <th className="text-left p-3 font-semibold text-slate-700">Method</th>
              <th className="text-right p-3 font-semibold text-slate-700">Amount</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="p-6 text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : payments.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-6 text-slate-500">
                  No payments match the filters.
                </td>
              </tr>
            ) : (
              payments.map((r) => {
                const st = studentById.get(r.student_id);
                const paid = r.paid_at ? new Date(r.paid_at) : null;
                return (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                    <td className="p-3 text-slate-800 whitespace-nowrap">
                      {paid ? paid.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—"}
                    </td>
                    <td className="p-3 text-slate-700">{studentLabel(r.student_id)}</td>
                    <td className="p-3 text-slate-600">{classLabelForStudent(st)}</td>
                    <td className="p-3 text-slate-800">{methodLabel(r.method)}</td>
                    <td className="p-3 text-right font-medium text-slate-900">{Number(r.amount).toLocaleString()}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
