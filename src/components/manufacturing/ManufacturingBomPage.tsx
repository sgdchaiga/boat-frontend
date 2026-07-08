import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import { ReadOnlyNotice } from "../common/ReadOnlyNotice";

type Product = {
  id: string;
  name: string;
  unit_of_measure?: string | null;
  manufacturing_item_type?: string | null;
};

type MaterialRow = {
  item_id: string;
  item_name: string;
  qty: number;
  unit: string;
};

type Bom = {
  id: string;
  product_id: string;
  product_name: string;
  version: string;
  output_qty: number;
  output_unit: string;
  status: "Draft" | "Active";
  materials: MaterialRow[];
};

export function ManufacturingBomPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!user?.isSuperAdmin;

  const [products, setProducts] = useState<Product[]>([]);
  const [boms, setBoms] = useState<Bom[]>([]);
  const [materials, setMaterials] = useState<MaterialRow[]>([]);

  const [productId, setProductId] = useState("");
  const [outputQty, setOutputQty] = useState(1);
  const [outputUnit, setOutputUnit] = useState("unit");
  const [version, setVersion] = useState("v1");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingBomId, setEditingBomId] = useState<string | null>(null);
  const [editingBomStatus, setEditingBomStatus] = useState<Bom["status"]>("Draft");
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // 🔹 Load products + BOMs
  useEffect(() => {
    loadAll();
  }, [orgId]);

  const loadAll = async () => {
    setLoading(true);
    setError(null);

    try {
      // Load products
      const productQuery = filterByOrganizationId(
        supabase.from("products").select("id,name,unit_of_measure,manufacturing_item_type"),
        orgId,
        superAdmin
      );
      const { data: prodData } = await productQuery;

      setProducts((prodData || []) as Product[]);

      // Load BOMs
      const bomQuery = filterByOrganizationId(
        supabase.from("manufacturing_boms").select("*"),
        orgId,
        superAdmin
      );

      const { data: bomData } = await bomQuery.order("id", { ascending: false });

      const mapped: Bom[] = (bomData || []).map((r: any) => ({
        id: r.id,
        product_id: r.product_id,
        product_name: r.product_name,
        version: r.version,
        output_qty: r.output_qty,
        output_unit: r.output_unit,
        status: r.status,
        materials: r.materials || [],
      }));

      setBoms(mapped);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // 🔹 Add new material row
  const finishedProducts = products.filter((p) => p.manufacturing_item_type === "finished_product");
  const materialProducts = products.filter(
    (p) => p.manufacturing_item_type === "raw_material" || p.manufacturing_item_type === "consumable"
  );

  const addMaterial = () => {
    setMaterials([...materials, { item_id: "", item_name: "", qty: 1, unit: "unit" }]);
  };

  // 🔹 Update material
  const updateMaterial = (index: number, field: keyof MaterialRow, value: any) => {
    const updated = [...materials];
    (updated[index] as any)[field] = value;
    setMaterials(updated);
  };

  // 🔹 Remove material
  const removeMaterial = (index: number) => {
    setMaterials(materials.filter((_, i) => i !== index));
  };

  const startEdit = (bom: Bom) => {
    if (readOnly) return;
    setEditingBomId(bom.id);
    setEditingBomStatus(bom.status);
    setProductId(bom.product_id);
    setOutputQty(bom.output_qty);
    setOutputUnit(bom.output_unit);
    setVersion(bom.version);
    setMaterials(bom.materials || []);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelEdit = () => {
    setEditingBomId(null);
    setEditingBomStatus("Draft");
    setMaterials([]);
    setProductId("");
    setOutputQty(1);
    setOutputUnit("unit");
    setVersion("v1");
  };

  // 🔹 Save BOM
  const handleSave = async () => {
    if (readOnly) return;

    if (!productId) return alert("Select product");
    if (materials.length === 0) return alert("Add at least one material");
    if (outputQty <= 0) return alert("Output must be greater than 0");

    setSaving(true);

    try {
      const product = products.find((p) => p.id === productId);

      const payload: any = {
        product_id: productId,
        product_name: product?.name,
        version,
        output_qty: outputQty,
        output_unit: outputUnit,
        status: editingBomId ? editingBomStatus : "Draft",
        materials,
        materials_count: materials.length,
      };

      if (orgId) payload.organization_id = orgId;

      const { error } = editingBomId
        ? await supabase.from("manufacturing_boms").update(payload).eq("id", editingBomId)
        : await supabase.from("manufacturing_boms").insert(payload);
      if (error) throw error;

      // reset
      cancelEdit();

      await loadAll();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  // 🔹 Filter
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return boms.filter(
      (b) =>
        b.product_name?.toLowerCase().includes(q) ||
        b.id?.toLowerCase().includes(q)
    );
  }, [search, boms]);

  return (
    <div className="p-6">

      {readOnly && <ReadOnlyNotice />}

      <h1 className="text-2xl font-bold mb-4">BOM Builder</h1>

      {/* 🔵 CREATE SECTION */}
      <div className="bg-white p-4 rounded-xl border mb-6">

        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-semibold">{editingBomId ? "Edit BOM" : "Step 1: Select Product"}</h2>
          {editingBomId && (
            <button
              type="button"
              onClick={cancelEdit}
              className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-600"
            >
              Cancel edit
            </button>
          )}
        </div>

        <select
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          className="border p-2 rounded w-full mb-4"
        >
          <option value="">-- Select Product --</option>
          {(finishedProducts.length > 0 ? finishedProducts : products).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.unit_of_measure || "unit"})
            </option>
          ))}
        </select>

        <h2 className="font-semibold mb-3">Step 2: Output</h2>

        <div className="flex gap-2 mb-4">
          <input
            type="number"
            value={outputQty}
            onChange={(e) => setOutputQty(Number(e.target.value))}
            className="border p-2 rounded w-1/2"
          />
          <input
            value={outputUnit}
            onChange={(e) => setOutputUnit(e.target.value)}
            className="border p-2 rounded w-1/2"
          />
        </div>

        <h2 className="font-semibold mb-3">Step 3: Materials</h2>

        {materials.map((m, i) => (
          <div key={i} className="flex gap-2 mb-2">

            <select
              value={m.item_id}
              onChange={(e) => {
                const p = products.find((row) => row.id === e.target.value);
                updateMaterial(i, "item_id", e.target.value);
                updateMaterial(i, "item_name", p?.name || "");
                updateMaterial(i, "unit", p?.unit_of_measure || "unit");
              }}
              className="border p-2 rounded w-1/3"
            >
              <option value="">Select raw material / consumable</option>
              {(materialProducts.length > 0 ? materialProducts : products).map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.unit_of_measure || "unit"})</option>
              ))}
            </select>

            <input
              type="number"
              value={m.qty}
              onChange={(e) => updateMaterial(i, "qty", Number(e.target.value))}
              className="border p-2 rounded w-1/4"
            />

            <input
              value={m.unit}
              onChange={(e) => updateMaterial(i, "unit", e.target.value)}
              className="border p-2 rounded w-1/4"
            />

            <button
              onClick={() => removeMaterial(i)}
              className="text-red-500"
            >
              ✕
            </button>

          </div>
        ))}

        <button onClick={addMaterial} className="text-blue-600 mb-4">
          + Add Material
        </button>

        <div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-blue-600 text-white px-4 py-2 rounded"
          >
            {saving ? "Saving..." : editingBomId ? "Update BOM" : "Save BOM"}
          </button>
        </div>
      </div>

      {/* 🔵 SEARCH */}
      <input
        placeholder="Search BOM..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="border p-2 rounded mb-4 w-full"
      />

      {/* 🔵 TABLE */}
      <div className="bg-white border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2">Product</th>
              <th className="p-2">Version</th>
              <th className="p-2 text-right">Output</th>
              <th className="p-2">Status</th>
              <th className="p-2 text-right">Actions</th>
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="text-center p-4">
                  Loading...
                </td>
              </tr>
            )}

            {filtered.map((b) => (
              <tr key={b.id} className="border-t">
                <td className="p-2">{b.product_name}</td>
                <td className="p-2">{b.version}</td>
                <td className="p-2 text-right">
                  {b.output_qty} {b.output_unit}
                </td>
                <td className="p-2">{b.status}</td>
                <td className="p-2 text-right">
                  <button
                    type="button"
                    onClick={() => startEdit(b)}
                    disabled={readOnly}
                    className="rounded border border-slate-300 px-3 py-1 text-sm text-blue-600 disabled:cursor-not-allowed disabled:text-slate-400"
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}

            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center p-4">
                  No BOMs found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {error && <p className="text-red-500 mt-3">{error}</p>}
    </div>
  );
}
