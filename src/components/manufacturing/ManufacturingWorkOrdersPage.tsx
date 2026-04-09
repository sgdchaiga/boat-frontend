import { useEffect, useMemo, useState } from "react";
import { PageNotes } from "../common/PageNotes";
import { ReadOnlyNotice } from "../common/ReadOnlyNotice";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";

export function ManufacturingWorkOrdersPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!user?.isSuperAdmin;
  const [rowsData, setRowsData] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [product, setProduct] = useState("");
  const [plannedQty, setPlannedQty] = useState("1");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadOrders();
  }, [orgId, superAdmin]);

  const loadOrders = async () => {
    setLoading(true);
    setError(null);
    try {
      const query = filterByOrganizationId(
        supabase.from("manufacturing_work_orders").select("*"),
        orgId,
        superAdmin
      );
      const { data, error: fetchError } = await query.order("id", { ascending: false });
      if (fetchError) throw fetchError;
      setRowsData((data || []) as Array<Record<string, unknown>>);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load work orders.");
      setRowsData([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (readOnly) return;
    if (!product.trim()) {
      alert("Enter product name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        product_name: product.trim(),
        planned_qty: Number(plannedQty || 0),
        start_date: startDate || null,
        due_date: dueDate || null,
        status: "Planned",
      };
      if (orgId) payload.organization_id = orgId;
      const { error: insertError } = await supabase.from("manufacturing_work_orders").insert(payload);
      if (insertError) throw insertError;
      setProduct("");
      setPlannedQty("1");
      setStartDate("");
      setDueDate("");
      await loadOrders();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create work order.");
    } finally {
      setSaving(false);
    }
  };

  const rows = useMemo(() => {
    if (!status) return rowsData;
    return rowsData.filter((r) => String(r.status ?? "") === status);
  }, [rowsData, status]);

  return (
    <div className="p-6 md:p-8">
      {readOnly && <ReadOnlyNotice />}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-bold text-slate-900">Work Orders</h1>
          <PageNotes ariaLabel="Manufacturing work orders help">
            <p>Create and monitor production jobs from planning to completion.</p>
          </PageNotes>
        </div>
        <button type="button" onClick={handleCreate} disabled={readOnly || saving} className="app-btn-primary disabled:cursor-not-allowed">
          {saving ? "Saving..." : "Save Work Order"}
        </button>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <label className="text-xs text-slate-600">Product<input value={product} onChange={(e) => setProduct(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
          <label className="text-xs text-slate-600">Planned Quantity<input type="number" min="0" step="0.01" value={plannedQty} onChange={(e) => setPlannedQty(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
          <label className="text-xs text-slate-600">Start Date<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
          <label className="text-xs text-slate-600">Due Date<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
          <label className="text-xs text-slate-600">Filter by Status
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
              <option value="">All</option>
              <option value="Planned">Planned</option>
              <option value="In Progress">In Progress</option>
              <option value="Completed">Completed</option>
            </select>
          </label>
        </div>
      </div>
      {error && <p className="text-sm text-red-600 my-3">{error}</p>}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mt-4">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="p-3 text-left">WO #</th>
              <th className="p-3 text-left">Product</th>
              <th className="p-3 text-right">Planned Qty</th>
              <th className="p-3 text-left">Start</th>
              <th className="p-3 text-left">Due</th>
              <th className="p-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="p-6 text-center text-slate-500">Loading...</td></tr>
            )}
            {rows.map((r) => (
              <tr key={String(r.id ?? "")} className="border-t">
                <td className="p-3 font-medium">{String(r.id ?? "")}</td>
                <td className="p-3">{String(r.product_name ?? r.product ?? "")}</td>
                <td className="p-3 text-right">{Number(r.planned_qty ?? 0).toFixed(2)}</td>
                <td className="p-3">{String(r.start_date ?? "")}</td>
                <td className="p-3">{String(r.due_date ?? "")}</td>
                <td className="p-3">{String(r.status ?? "")}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-slate-500">No work orders found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
