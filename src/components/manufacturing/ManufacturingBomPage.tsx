import { useEffect, useMemo, useState } from "react";
import { PageNotes } from "../common/PageNotes";
import { ReadOnlyNotice } from "../common/ReadOnlyNotice";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";

type BomRow = {
  id: string;
  product: string;
  version: string;
  materialsCount: number;
  outputQty: number;
  unit: string;
  status: "Draft" | "Active";
};

export function ManufacturingBomPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!user?.isSuperAdmin;
  const [rowsData, setRowsData] = useState<BomRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [product, setProduct] = useState("");
  const [version, setVersion] = useState("v1");
  const [materialsCount, setMaterialsCount] = useState("1");
  const [outputQty, setOutputQty] = useState("1");
  const [unit, setUnit] = useState("unit");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadBoms();
  }, [orgId, superAdmin]);

  const loadBoms = async () => {
    setLoading(true);
    setError(null);
    try {
      const query = filterByOrganizationId(
        supabase.from("manufacturing_boms").select("*"),
        orgId,
        superAdmin
      );
      const { data, error: fetchError } = await query.order("id", { ascending: false });
      if (fetchError) throw fetchError;
      const mapped = ((data || []) as Array<Record<string, unknown>>).map((r) => {
        const statusValue: BomRow["status"] = String(r.status ?? "Draft") === "Active" ? "Active" : "Draft";
        return {
          id: String(r.id ?? ""),
          product: String(r.product_name ?? r.product ?? ""),
          version: String(r.version ?? "v1"),
          materialsCount: Number(r.materials_count ?? 0),
          outputQty: Number(r.output_qty ?? 0),
          unit: String(r.output_unit ?? "unit"),
          status: statusValue,
        };
      });
      setRowsData(mapped);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load BOMs.");
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
        version: version.trim() || "v1",
        materials_count: Number(materialsCount || 0),
        output_qty: Number(outputQty || 0),
        output_unit: unit.trim() || "unit",
        status: "Draft",
      };
      if (orgId) payload.organization_id = orgId;
      const { error: insertError } = await supabase.from("manufacturing_boms").insert(payload);
      if (insertError) throw insertError;
      setProduct("");
      setVersion("v1");
      setMaterialsCount("1");
      setOutputQty("1");
      setUnit("unit");
      await loadBoms();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create BOM.");
    } finally {
      setSaving(false);
    }
  };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rowsData.filter((r) => r.product.toLowerCase().includes(q) || r.id.toLowerCase().includes(q)) : rowsData;
  }, [search, rowsData]);

  return (
    <div className="p-6 md:p-8">
      {readOnly && <ReadOnlyNotice />}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-bold text-slate-900">Bill of Materials</h1>
          <PageNotes ariaLabel="Manufacturing BOM help">
            <p>Define the material recipe for each finished product and control versioning.</p>
          </PageNotes>
        </div>
        <button type="button" onClick={handleCreate} disabled={readOnly || saving} className="app-btn-primary disabled:cursor-not-allowed">
          {saving ? "Saving..." : "Save BOM"}
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Create BOM</p>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
          <label className="text-xs text-slate-600">Product<input value={product} onChange={(e) => setProduct(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
          <label className="text-xs text-slate-600">Version<input value={version} onChange={(e) => setVersion(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
          <label className="text-xs text-slate-600">Materials Count<input type="number" min="0" value={materialsCount} onChange={(e) => setMaterialsCount(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
          <label className="text-xs text-slate-600">Output Quantity<input type="number" min="0" step="0.01" value={outputQty} onChange={(e) => setOutputQty(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
          <label className="text-xs text-slate-600">Output Unit<input value={unit} onChange={(e) => setUnit(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
        </div>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
          <label className="text-xs text-slate-600">Search BOM<input value={search} onChange={(e) => setSearch(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
        </div>
      </div>
      {error && <p className="text-sm text-red-600 my-3">{error}</p>}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mt-4">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="p-3 text-left">BOM #</th>
              <th className="p-3 text-left">Product</th>
              <th className="p-3 text-left">Version</th>
              <th className="p-3 text-right">Materials</th>
              <th className="p-3 text-right">Output Qty</th>
              <th className="p-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-slate-500">Loading...</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-3 font-medium">{r.id}</td>
                <td className="p-3">{r.product}</td>
                <td className="p-3">{r.version}</td>
                <td className="p-3 text-right">{r.materialsCount}</td>
                <td className="p-3 text-right">{r.outputQty} {r.unit}</td>
                <td className="p-3">{r.status}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-slate-500">No BOM records found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
