import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";

type SpecialFeeRow = {
  id: string;
  fee_type: "new_student" | "exam" | "uneb";
  academic_year: string;
  term_name: string;
  amount: number;
  notes: string | null;
  is_active: boolean;
};

type Props = { readOnly?: boolean };

export function SchoolSpecialFeeStructuresPage({ readOnly }: Props) {
  const { user } = useAuth();
  const [rows, setRows] = useState<SpecialFeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    fee_type: "new_student" as SpecialFeeRow["fee_type"],
    academic_year: new Date().getFullYear().toString(),
    term_name: "Term 1",
    amount: "",
    notes: "",
    is_active: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    const orgId = user?.organization_id;
    if (!orgId) {
      setRows([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("school_special_fee_structures")
      .select("id,fee_type,academic_year,term_name,amount,notes,is_active")
      .eq("organization_id", orgId)
      .order("academic_year", { ascending: false })
      .order("term_name", { ascending: false });
    setErr(error?.message ?? null);
    setRows((data as SpecialFeeRow[]) || []);
    setLoading(false);
  }, [user?.organization_id]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (readOnly) return;
    if (!form.academic_year.trim() || !form.term_name.trim() || !form.amount) {
      setErr("Year, term and amount are required.");
      return;
    }
    const amount = Number(form.amount);
    if (!(amount >= 0)) {
      setErr("Amount must be 0 or more.");
      return;
    }
    setErr(null);
    const { error } = await supabase.from("school_special_fee_structures").insert({
      fee_type: form.fee_type,
      academic_year: form.academic_year.trim(),
      term_name: form.term_name.trim(),
      amount,
      notes: form.notes.trim() || null,
      is_active: form.is_active,
    });
    if (error) {
      setErr(error.message);
      return;
    }
    setForm((f) => ({ ...f, amount: "", notes: "" }));
    void load();
  };

  const feeTypeLabel = (t: SpecialFeeRow["fee_type"]) =>
    t === "new_student" ? "New students" : t === "exam" ? "Exam fees" : "UNEB fees";

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Special fee structures</h1>
        <PageNotes ariaLabel="Special fees">
          <p>Define structured charges for new students, exam fees, and UNEB fees per term.</p>
        </PageNotes>
      </div>
      {err && <p className="text-red-600 text-sm">{err}</p>}
      {!readOnly && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <select
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            value={form.fee_type}
            onChange={(e) => setForm((f) => ({ ...f, fee_type: e.target.value as SpecialFeeRow["fee_type"] }))}
          >
            <option value="new_student">New students</option>
            <option value="exam">Exam fees</option>
            <option value="uneb">UNEB fees</option>
          </select>
          <input className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={form.academic_year} onChange={(e) => setForm((f) => ({ ...f, academic_year: e.target.value }))} placeholder="Academic year" />
          <input className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={form.term_name} onChange={(e) => setForm((f) => ({ ...f, term_name: e.target.value }))} placeholder="Term" />
          <input type="number" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="Amount" />
          <input className="border border-slate-300 rounded-lg px-3 py-2 text-sm md:col-span-2" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Notes (optional)" />
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} />
            Active
          </label>
          <button type="button" onClick={save} className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-800 w-fit">
            Save special fee
          </button>
        </div>
      )}
      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left p-3 font-semibold text-slate-700">Fee type</th>
              <th className="text-left p-3 font-semibold text-slate-700">Year / term</th>
              <th className="text-right p-3 font-semibold text-slate-700">Amount</th>
              <th className="text-left p-3 font-semibold text-slate-700">Notes</th>
              <th className="text-left p-3 font-semibold text-slate-700">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="p-6 text-slate-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="p-6 text-slate-500">No special fee structures yet.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="p-3 text-slate-700">{feeTypeLabel(r.fee_type)}</td>
                  <td className="p-3 text-slate-700">{r.academic_year} · {r.term_name}</td>
                  <td className="p-3 text-right text-slate-900">{Number(r.amount).toLocaleString()}</td>
                  <td className="p-3 text-slate-600">{r.notes ?? "—"}</td>
                  <td className="p-3 text-slate-600">{r.is_active ? "Active" : "Inactive"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
