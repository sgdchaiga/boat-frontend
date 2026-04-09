import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";

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

type Filters = {
  dateFrom: string;
  dateTo: string;
  method: "" | (typeof METHODS)[number];
  studentId: string;
  classId: string;
};

type Props = { readOnly?: boolean };

function localDayStart(ymd: string): Date | null {
  if (!ymd?.trim()) return null;
  const parts = ymd.split("-").map(Number);
  const [y, m, d] = parts;
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function localDayEnd(ymd: string): Date | null {
  if (!ymd?.trim()) return null;
  const parts = ymd.split("-").map(Number);
  const [y, m, d] = parts;
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

export function SchoolCollectionsSummaryPage({ readOnly: _readOnly }: Props) {
  const { user } = useAuth();
  const [payments, setPayments] = useState<PayRow[]>([]);
  const [students, setStudents] = useState<StudentOpt[]>([]);
  const [classes, setClasses] = useState<ClassOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({
    dateFrom: "",
    dateTo: "",
    method: "",
    studentId: "",
    classId: "",
  });

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
    const orgId = user?.organization_id;
    if (!orgId) {
      setLoading(false);
      return;
    }

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
      .order("paid_at", { ascending: false });

    const start = localDayStart(filters.dateFrom);
    const end = localDayEnd(filters.dateTo);
    if (start) q = q.gte("paid_at", start.toISOString());
    if (end) q = q.lte("paid_at", end.toISOString());
    if (filters.method) q = q.eq("method", filters.method);
    if (filters.studentId) q = q.eq("student_id", filters.studentId);

    const { data, error } = await q;
    setErr(error?.message || null);
    let list = (data as PayRow[]) || [];

    const studs = (sRes.data as StudentOpt[]) || [];
    const clsList = (cRes.data as ClassOpt[]) || [];
    const studMap = new Map(studs.map((s) => [s.id, s]));

    if (filters.classId) {
      const c = clsList.find((x) => x.id === filters.classId);
      const name = c?.name?.trim().toLowerCase() ?? "";
      list = list.filter((p) => {
        const st = studMap.get(p.student_id);
        if (!st) return false;
        if (st.class_id === filters.classId) return true;
        if (name && (st.class_name ?? "").trim().toLowerCase() === name) return true;
        return false;
      });
    }

    setPayments(list);
    setLoading(false);
  }, [user?.organization_id, filters.dateFrom, filters.dateTo, filters.method, filters.studentId, filters.classId]);

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

  const clearFilters = () =>
    setFilters({ dateFrom: "", dateTo: "", method: "", studentId: "", classId: "" });

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Daily collections</h1>
        <PageNotes ariaLabel="Collections">
          <p>
            Lists <code className="text-xs bg-slate-200 px-1 rounded">school_payments</code> with payment method. Filter by date range (local calendar days),
            method, student, or class. Class uses the student&apos;s catalog link or stored class name.
          </p>
        </PageNotes>
      </div>
      {err && <p className="text-red-600 text-sm">{err}</p>}

      <div className="rounded-xl border border-slate-200 bg-white p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          From date
          <input
            type="date"
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900"
            value={filters.dateFrom}
            onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          To date
          <input
            type="date"
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900"
            value={filters.dateTo}
            onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
          />
        </label>
        <select
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm self-end"
          value={filters.method}
          onChange={(e) => setFilters((f) => ({ ...f, method: e.target.value as Filters["method"] }))}
        >
          <option value="">All payment methods</option>
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {METHOD_LABEL[m]}
            </option>
          ))}
        </select>
        <select
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm lg:col-span-1"
          value={filters.studentId}
          onChange={(e) => setFilters((f) => ({ ...f, studentId: e.target.value }))}
        >
          <option value="">All students</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.admission_number} — {s.first_name} {s.last_name}
            </option>
          ))}
        </select>
        <select
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          value={filters.classId}
          onChange={(e) => setFilters((f) => ({ ...f, classId: e.target.value }))}
        >
          <option value="">All classes</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="flex items-end">
          <button
            type="button"
            onClick={clearFilters}
            className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Clear filters
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 flex flex-wrap gap-6 text-sm">
        <div>
          <span className="text-slate-500">Payments in view: </span>
          <span className="font-semibold text-slate-900">{payments.length}</span>
        </div>
        <div>
          <span className="text-slate-500">Total collected: </span>
          <span className="font-semibold text-slate-900">{grandTotal.toLocaleString()}</span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
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
              <th className="text-left p-3 font-semibold text-slate-700">Reference</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="p-6 text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : payments.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-6 text-slate-500">
                  No payments match the current filters.
                </td>
              </tr>
            ) : (
              payments.map((r) => {
                const st = studentById.get(r.student_id);
                const paid = r.paid_at ? new Date(r.paid_at) : null;
                return (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                    <td className="p-3 text-slate-800 whitespace-nowrap">
                      {paid
                        ? paid.toLocaleString(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })
                        : "—"}
                    </td>
                    <td className="p-3 text-slate-700">{studentLabel(r.student_id)}</td>
                    <td className="p-3 text-slate-600">{classLabelForStudent(st)}</td>
                    <td className="p-3 text-slate-800 capitalize">{methodLabel(r.method)}</td>
                    <td className="p-3 text-right font-medium text-slate-900">{Number(r.amount).toLocaleString()}</td>
                    <td className="p-3 text-slate-600 font-mono text-xs">{r.reference?.trim() || "—"}</td>
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
