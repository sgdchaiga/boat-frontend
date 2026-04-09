import { useEffect, useMemo, useState } from "react";
import { PageNotes } from "../common/PageNotes";
import { ReadOnlyNotice } from "../common/ReadOnlyNotice";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";

export function ManufacturingProductionEntriesPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!user?.isSuperAdmin;
  const [rowsData, setRowsData] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [workOrder, setWorkOrder] = useState("");
  const [product, setProduct] = useState("");
  const [producedQty, setProducedQty] = useState("0");
  const [scrapQty, setScrapQty] = useState("0");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadEntries();
  }, [orgId, superAdmin]);

  const loadEntries = async () => {
    setLoading(true);
    setError(null);
    try {
      const query = filterByOrganizationId(
        supabase.from("manufacturing_production_entries").select("*"),
        orgId,
        superAdmin
      );
      const { data, error: fetchError } = await query.order("id", { ascending: false });
      if (fetchError) throw fetchError;
      setRowsData((data || []) as Array<Record<string, unknown>>);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load production entries.");
      setRowsData([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (readOnly) return;
    if (!workOrder.trim()) {
      alert("Enter work order.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        work_order_id: workOrder.trim(),
        product_name: product.trim() || null,
        produced_qty: Number(producedQty || 0),
        scrap_qty: Number(scrapQty || 0),
        posted_at: new Date().toISOString(),
      };
      if (orgId) payload.organization_id = orgId;
      const { error: insertError } = await supabase.from("manufacturing_production_entries").insert(payload);
      if (insertError) throw insertError;
      setWorkOrder("");
      setProduct("");
      setProducedQty("0");
      setScrapQty("0");
      await loadEntries();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create production entry.");
    } finally {
      setSaving(false);
    }
  };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? rowsData.filter((r) => String(r.id ?? "").toLowerCase().includes(q) || String(r.work_order_id ?? "").toLowerCase().includes(q))
      : rowsData;
  }, [search, rowsData]);

  return (
    <div className="p-6 md:p-8">
      {readOnly && <ReadOnlyNotice />}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-bold text-slate-900">Production Entries</h1>
          <PageNotes ariaLabel="Manufacturing production entries help">
            <p>Capture finished output and scrap before inventory/GL posting.</p>
          </PageNotes>
        </div>
        <button type="button" onClick={handleCreate} disabled={readOnly || saving} className="app-btn-primary disabled:cursor-not-allowed">
          {saving ? "Saving..." : "Save Entry"}
        </button>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <label className="text-xs text-slate-600">Work Order<input value={workOrder} onChange={(e) => setWorkOrder(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
          <label className="text-xs text-slate-600">Product<input value={product} onChange={(e) => setProduct(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
          <label className="text-xs text-slate-600">Produced Quantity<input type="number" min="0" step="0.01" value={producedQty} onChange={(e) => setProducedQty(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
          <label className="text-xs text-slate-600">Scrap Quantity<input type="number" min="0" step="0.01" value={scrapQty} onChange={(e) => setScrapQty(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
          <label className="text-xs text-slate-600">Search<input value={search} onChange={(e) => setSearch(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
        </div>
      </div>
      {error && <p className="text-sm text-red-600 my-3">{error}</p>}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mt-4">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="p-3 text-left">Entry #</th>
              <th className="p-3 text-left">Work Order</th>
              <th className="p-3 text-left">Product</th>
              <th className="p-3 text-right">Produced</th>
              <th className="p-3 text-right">Scrap</th>
              <th className="p-3 text-left">Posted</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="p-6 text-center text-slate-500">Loading...</td></tr>}
            {rows.map((r) => (
              <tr key={String(r.id ?? "")} className="border-t">
                <td className="p-3 font-medium">{String(r.id ?? "")}</td>
                <td className="p-3">{String(r.work_order_id ?? r.work_order ?? "")}</td>
                <td className="p-3">{String(r.product_name ?? r.product ?? "")}</td>
                <td className="p-3 text-right">{Number(r.produced_qty ?? 0).toFixed(2)}</td>
                <td className="p-3 text-right">{Number(r.scrap_qty ?? 0).toFixed(2)}</td>
                <td className="p-3">{String(r.posted_at ?? r.created_at ?? "")}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-500">No production entries found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
