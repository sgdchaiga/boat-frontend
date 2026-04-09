import { useEffect, useMemo, useState } from "react";
import { PageNotes } from "../common/PageNotes";
import { ReadOnlyNotice } from "../common/ReadOnlyNotice";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";

export function ManufacturingCostingPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!user?.isSuperAdmin;
  const [rowsData, setRowsData] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState("");
  const [product, setProduct] = useState("");
  const [materialCost, setMaterialCost] = useState("0");
  const [laborCost, setLaborCost] = useState("0");
  const [overheadCost, setOverheadCost] = useState("0");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadCosts();
  }, [orgId, superAdmin]);

  const loadCosts = async () => {
    setLoading(true);
    setError(null);
    try {
      const query = filterByOrganizationId(
        supabase.from("manufacturing_costing_entries").select("*"),
        orgId,
        superAdmin
      );
      const { data, error: fetchError } = await query.order("id", { ascending: false });
      if (fetchError) throw fetchError;
      setRowsData((data || []) as Array<Record<string, unknown>>);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load costing entries.");
      setRowsData([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (readOnly) return;
    if (!product.trim() || !period) {
      alert("Enter product and period.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        product_name: product.trim(),
        period,
        material_cost: Number(materialCost || 0),
        labor_cost: Number(laborCost || 0),
        overhead_cost: Number(overheadCost || 0),
      };
      if (orgId) payload.organization_id = orgId;
      const { error: insertError } = await supabase.from("manufacturing_costing_entries").insert(payload);
      if (insertError) throw insertError;
      setProduct("");
      setMaterialCost("0");
      setLaborCost("0");
      setOverheadCost("0");
      await loadCosts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create costing entry.");
    } finally {
      setSaving(false);
    }
  };

  const rows = useMemo(
    () => (period ? rowsData.filter((r) => String(r.period ?? "") === period) : rowsData),
    [period, rowsData]
  );

  return (
    <div className="p-6 md:p-8">
      {readOnly && <ReadOnlyNotice />}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-bold text-slate-900">Costing</h1>
          <PageNotes ariaLabel="Manufacturing costing help">
            <p>Review and reconcile material, labor, and overhead costs by period.</p>
          </PageNotes>
        </div>
        <button type="button" onClick={handleCreate} disabled={readOnly || saving} className="app-btn-primary disabled:cursor-not-allowed">
          {saving ? "Saving..." : "Save Costing"}
        </button>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
          <label className="text-xs text-slate-600">Product<input value={product} onChange={(e) => setProduct(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
          <label className="text-xs text-slate-600">Period<input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
          <label className="text-xs text-slate-600">Material Cost<input type="number" min="0" step="0.01" value={materialCost} onChange={(e) => setMaterialCost(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
          <label className="text-xs text-slate-600">Labor Cost<input type="number" min="0" step="0.01" value={laborCost} onChange={(e) => setLaborCost(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
          <label className="text-xs text-slate-600">Overhead Cost<input type="number" min="0" step="0.01" value={overheadCost} onChange={(e) => setOverheadCost(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
        </div>
      </div>
      {error && <p className="text-sm text-red-600 my-3">{error}</p>}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mt-4">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="p-3 text-left">Product</th>
              <th className="p-3 text-left">Period</th>
              <th className="p-3 text-right">Material</th>
              <th className="p-3 text-right">Labor</th>
              <th className="p-3 text-right">Overhead</th>
              <th className="p-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="p-6 text-center text-slate-500">Loading...</td></tr>}
            {rows.map((r, idx) => {
              const material = Number(r.material_cost ?? 0);
              const labor = Number(r.labor_cost ?? 0);
              const overhead = Number(r.overhead_cost ?? 0);
              const total = material + labor + overhead;
              return (
                <tr key={`${String(r.id ?? idx)}`} className="border-t">
                  <td className="p-3">{String(r.product_name ?? r.product ?? "")}</td>
                  <td className="p-3">{String(r.period ?? "")}</td>
                  <td className="p-3 text-right">{material.toFixed(2)}</td>
                  <td className="p-3 text-right">{labor.toFixed(2)}</td>
                  <td className="p-3 text-right">{overhead.toFixed(2)}</td>
                  <td className="p-3 text-right font-semibold">{total.toFixed(2)}</td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-500">No costing entries found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
