import { useEffect, useMemo, useState } from "react";
import { Save } from "lucide-react";
import { supabase } from "../lib/supabase";
import { ReadOnlyNotice } from "./common/ReadOnlyNotice";
import { PageNotes } from "./common/PageNotes";

type ProductRow = {
  id: string;
  name: string | null;
  barcode?: string | null;
  sku?: string | null;
  code?: string | null;
};

interface InventoryBarcodesPageProps {
  readOnly?: boolean;
}

export function InventoryBarcodesPage({ readOnly = false }: InventoryBarcodesPageProps) {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [barcodeValue, setBarcodeValue] = useState("");

  useEffect(() => {
    void loadProducts();
  }, []);

  async function loadProducts() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("products")
        .select("id,name,barcode,sku,code")
        .order("name");
      if (error) {
        console.error("Failed to load products for barcode mapping", error);
        return;
      }
      setProducts((data || []) as ProductRow[]);
    } finally {
      setLoading(false);
    }
  }

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return products;
    return products.filter((row) =>
      [(row.name || "").toLowerCase(), (row.barcode || "").toLowerCase(), (row.sku || "").toLowerCase(), (row.code || "").toLowerCase()].some(
        (v) => v.includes(term)
      )
    );
  }, [products, search]);

  const selectedProduct = useMemo(
    () => products.find((row) => row.id === selectedProductId) ?? null,
    [products, selectedProductId]
  );

  useEffect(() => {
    if (!selectedProduct) {
      setBarcodeValue("");
      return;
    }
    setBarcodeValue((selectedProduct.barcode || "").trim());
  }, [selectedProduct]);

  async function saveBarcode() {
    if (readOnly) {
      alert("Subscription inactive: Inventory is in read-only mode.");
      return;
    }
    if (!selectedProductId) {
      alert("Select a product first.");
      return;
    }
    setSaving(true);
    try {
      const normalized = barcodeValue.trim() || null;
      const { error } = await supabase
        .from("products")
        .update({ barcode: normalized })
        .eq("id", selectedProductId);
      if (error) {
        alert(error.message || "Failed to save barcode.");
        return;
      }
      setProducts((prev) =>
        prev.map((row) => (row.id === selectedProductId ? { ...row, barcode: normalized } : row))
      );
      alert("Barcode saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 md:p-8 space-y-6">
      {readOnly && <ReadOnlyNotice />}

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-3xl font-bold text-slate-900">Inventory Barcodes</h1>
        <PageNotes ariaLabel="Inventory barcode help">
          <p>Pick a product and store its barcode without crowding the Products form.</p>
        </PageNotes>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 md:p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Find product</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, barcode, SKU, or code"
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Select product</label>
            <div className="flex items-center gap-2">
              <select
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2"
              >
                <option value="">Select product</option>
                {filteredProducts.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name || "Unnamed product"}
                  </option>
                ))}
              </select>
              {selectedProductId && (
                <button
                  type="button"
                  onClick={() => setSelectedProductId("")}
                  className="px-3 py-2 text-xs border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Barcode</label>
            <input
              type="text"
              value={barcodeValue}
              onChange={(e) => setBarcodeValue(e.target.value)}
              placeholder="Scan or type barcode"
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
              disabled={!selectedProductId}
            />
          </div>
          <button
            type="button"
            onClick={() => void saveBarcode()}
            disabled={!selectedProductId || saving || readOnly}
            className="inline-flex items-center justify-center gap-2 bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium"
          >
            <Save className="w-4 h-4" />
            {saving ? "Saving..." : "Save barcode"}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left p-3">Product</th>
              <th className="text-left p-3">Current barcode</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="p-4 text-slate-500" colSpan={2}>
                  Loading products...
                </td>
              </tr>
            ) : filteredProducts.length === 0 ? (
              <tr>
                <td className="p-4 text-slate-500" colSpan={2}>
                  No products found.
                </td>
              </tr>
            ) : (
              filteredProducts.map((row) => (
                <tr
                  key={row.id}
                  className={`border-t border-slate-100 cursor-pointer ${row.id === selectedProductId ? "bg-brand-50/50" : "hover:bg-slate-50"}`}
                  onClick={() => setSelectedProductId(row.id)}
                >
                  <td className="p-3">{row.name || "Unnamed product"}</td>
                  <td className="p-3">{row.barcode || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
