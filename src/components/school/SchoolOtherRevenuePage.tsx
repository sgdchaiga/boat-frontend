import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";
import { normalizeGlAccountRows } from "@/lib/glAccountNormalize";

type RevenueRow = {
  id: string;
  revenue_type: string;
  payer_name: string | null;
  amount: number;
  method: string;
  reference: string | null;
  received_at: string;
  notes: string | null;
};
type RevenueTypeOpt = { id: string; account_code: string; account_name: string; account_type: string };

type Props = { readOnly?: boolean };

export function SchoolOtherRevenuePage({ readOnly }: Props) {
  const { user } = useAuth();
  const [rows, setRows] = useState<RevenueRow[]>([]);
  const [revenueTypes, setRevenueTypes] = useState<RevenueTypeOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    revenue_type: "",
    payer_name: "",
    amount: "",
    method: "cash",
    reference: "",
    notes: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const orgId = user?.organization_id;
    if (!orgId) {
      setRows([]);
      setLoading(false);
      return;
    }
    const [revRes, glRes] = await Promise.all([
      supabase
        .from("school_other_revenue")
        .select("id,revenue_type,payer_name,amount,method,reference,received_at,notes")
        .eq("organization_id", orgId)
        .order("received_at", { ascending: false }),
      supabase
        .from("gl_accounts")
        .select("*")
        .order("account_code", { ascending: true }),
    ]);
    setErr(revRes.error?.message ?? glRes.error?.message ?? null);
    setRows((revRes.data as RevenueRow[]) || []);
    const normalizedRevenueTypes = normalizeGlAccountRows((glRes.data || []) as unknown[])
      .filter((row) => row.is_active && (row.account_type === "income" || row.account_type === "revenue"))
      .map((row) => ({
        id: row.id,
        account_code: row.account_code,
        account_name: row.account_name,
        account_type: row.account_type,
      }));
    setRevenueTypes(normalizedRevenueTypes as RevenueTypeOpt[]);
    setLoading(false);
  }, [user?.organization_id]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (readOnly) return;
    if (!form.revenue_type.trim() || !form.amount) {
      setErr("Revenue type and amount are required.");
      return;
    }
    const amount = Number(form.amount);
    if (!(amount > 0)) {
      setErr("Amount must be positive.");
      return;
    }
    setErr(null);
    const { error } = await supabase.from("school_other_revenue").insert({
      revenue_type: form.revenue_type.trim(),
      payer_name: form.payer_name.trim() || null,
      amount,
      method: form.method,
      reference: form.reference.trim() || null,
      notes: form.notes.trim() || null,
    });
    if (error) {
      setErr(error.message);
      return;
    }
    setForm({
      revenue_type: "",
      payer_name: "",
      amount: "",
      method: "cash",
      reference: "",
      notes: "",
    });
    void load();
  };

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Other revenue</h1>
        <PageNotes ariaLabel="Other revenue">
          <p>Capture non-school-fee income such as hall hire, donations, and voluntary contributions.</p>
        </PageNotes>
      </div>
      {err && <p className="text-red-600 text-sm">{err}</p>}

      {!readOnly && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <select
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            value={form.revenue_type}
            onChange={(e) => setForm((f) => ({ ...f, revenue_type: e.target.value }))}
          >
            <option value="">Revenue type (from Chart of Accounts)</option>
            {revenueTypes.map((a) => (
              <option key={a.id} value={`${a.account_code} — ${a.account_name}`}>
                {a.account_code} — {a.account_name}
              </option>
            ))}
          </select>
          <input
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="Payer name (optional)"
            value={form.payer_name}
            onChange={(e) => setForm((f) => ({ ...f, payer_name: e.target.value }))}
          />
          <input
            type="number"
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="Amount"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          />
          <select
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            value={form.method}
            onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}
          >
            <option value="cash">Cash</option>
            <option value="mobile_money">Mobile money</option>
            <option value="bank">Bank</option>
            <option value="transfer">Transfer</option>
            <option value="other">Other</option>
          </select>
          <input
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="Reference (optional)"
            value={form.reference}
            onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
          />
          <input
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="Notes (optional)"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
          <button
            type="button"
            onClick={save}
            className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-800 w-fit"
          >
            Record revenue
          </button>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left p-3 font-semibold text-slate-700">When</th>
              <th className="text-left p-3 font-semibold text-slate-700">Type</th>
              <th className="text-left p-3 font-semibold text-slate-700">Payer</th>
              <th className="text-right p-3 font-semibold text-slate-700">Amount</th>
              <th className="text-left p-3 font-semibold text-slate-700">Method</th>
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
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-6 text-slate-500">
                  No other revenue yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                  <td className="p-3 text-slate-700">{new Date(r.received_at).toLocaleString()}</td>
                  <td className="p-3 text-slate-700">{r.revenue_type}</td>
                  <td className="p-3 text-slate-600">{r.payer_name ?? "—"}</td>
                  <td className="p-3 text-right text-slate-900">{Number(r.amount).toLocaleString()}</td>
                  <td className="p-3 capitalize text-slate-600">{r.method.replace("_", " ")}</td>
                  <td className="p-3 text-slate-600">{r.reference ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
