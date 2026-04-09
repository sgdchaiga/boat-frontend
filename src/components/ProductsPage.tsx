import { useEffect, useState } from "react";
import { Edit, CheckCircle, XCircle, Save, Plus, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { Database } from "../lib/database.types";
import { ReadOnlyNotice } from "./common/ReadOnlyNotice";
import { PageNotes } from "./common/PageNotes";

type Product = Database["public"]["Tables"]["products"]["Row"];
type GLAccount = Database["public"]["Tables"]["gl_accounts"]["Row"];
type Department = Database["public"]["Tables"]["departments"]["Row"];

interface ProductsPageProps {
  readOnly?: boolean;
}

function fmtMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Gross margin amount and % of sales price. */
function marginFromPrices(cost: number | null | undefined, sale: number | null | undefined): { amount: number; pct: number } | null {
  const c = Number(cost ?? 0);
  const s = Number(sale ?? 0);
  if (!Number.isFinite(c) || !Number.isFinite(s) || s <= 0) return null;
  const amount = s - c;
  const pct = (amount / s) * 100;
  return { amount, pct };
}

export default function ProductsPage({ readOnly = false }: ProductsPageProps = {}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [balanceByProduct, setBalanceByProduct] = useState<Record<string, number>>({});
  const [glAccounts, setGlAccounts] = useState<GLAccount[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const [formData, setFormData] = useState({
    name: "",
    cost_price: 0,
    sales_price: 0,
    reorder_level: "" as string,
    department_id: "",
    income_account: "",
    stock_account: "",
    purchases_account: "",
    purchasable: true,
    saleable: true,
    track_inventory: true,
    active: true,
  });

  const [search, setSearch] = useState("");

  useEffect(() => {
    void loadAll();
  }, []);

  async function loadAll() {
    await Promise.all([loadProductsAndBalances(), loadAccounts(), loadDepartments()]);
  }

  async function loadProductsAndBalances() {
    const [prodRes, movesRes] = await Promise.all([
      supabase.from("products").select("*").order("name"),
      supabase.from("product_stock_movements").select("product_id,quantity_in,quantity_out"),
    ]);

    if (prodRes.error) {
      console.error(prodRes.error);
      return;
    }
    const list = (prodRes.data || []) as Product[];
    setProducts(list);

    const bal: Record<string, number> = {};
    list.forEach((p) => {
      bal[p.id] = 0;
    });

    if (!movesRes.error && movesRes.data) {
      for (const m of movesRes.data as Array<{ product_id: string; quantity_in: number | null; quantity_out: number | null }>) {
        if (bal[m.product_id] === undefined) continue;
        bal[m.product_id] += Number(m.quantity_in || 0) - Number(m.quantity_out || 0);
      }
    }
    setBalanceByProduct(bal);
  }

  async function loadAccounts() {
    const { data } = await supabase.from("gl_accounts").select("*").order("account_name");
    if (data) setGlAccounts(data);
  }

  async function loadDepartments() {
    const { data } = await supabase.from("departments").select("*").order("name");
    if (data) setDepartments(data);
  }

  function resetForm() {
    setEditingProduct(null);
    setFormData({
      name: "",
      cost_price: 0,
      sales_price: 0,
      reorder_level: "",
      department_id: "",
      income_account: "",
      stock_account: "",
      purchases_account: "",
      purchasable: true,
      saleable: true,
      track_inventory: true,
      active: true,
    });
  }

  function openNewItem() {
    resetForm();
    setModalOpen(true);
  }

  function editProduct(product: Product) {
    setEditingProduct(product);
    const rl = product.reorder_level;
    setFormData({
      name: product.name ?? "",
      cost_price: Number(product.cost_price ?? 0),
      sales_price: Number(product.sales_price ?? 0),
      reorder_level: rl != null && rl !== undefined ? String(rl) : "",
      department_id: product.department_id ?? "",
      income_account: product.income_account ?? "",
      stock_account: product.stock_account ?? "",
      purchases_account: product.purchases_account ?? "",
      purchasable: product.purchasable ?? true,
      saleable: product.saleable ?? true,
      track_inventory: product.track_inventory ?? true,
      active: product.active ?? true,
    });
    setModalOpen(true);
  }

  async function saveProduct() {
    if (readOnly) {
      alert("Subscription inactive: Products is in read-only mode.");
      return;
    }

    if (!formData.name.trim()) {
      alert("Please enter a product name.");
      return;
    }

    if (formData.saleable && (!formData.sales_price || formData.sales_price <= 0)) {
      alert("Saleable products must have a sales price greater than 0.");
      return;
    }

    const reorderParsed =
      formData.reorder_level.trim() === "" ? null : Number(formData.reorder_level);
    if (reorderParsed != null && (Number.isNaN(reorderParsed) || reorderParsed < 0)) {
      alert("Reorder level must be a non-negative number.");
      return;
    }

    const payload = {
      name: formData.name.trim(),
      cost_price: formData.cost_price,
      sales_price: formData.sales_price,
      reorder_level: reorderParsed,
      department_id: formData.department_id || null,
      income_account: formData.income_account || null,
      stock_account: formData.stock_account || null,
      purchases_account: formData.purchases_account || null,
      purchasable: formData.purchasable,
      saleable: formData.saleable,
      track_inventory: formData.track_inventory,
      active: formData.active,
    };

    try {
      if (editingProduct) {
        const { error } = await supabase.from("products").update(payload).eq("id", editingProduct.id);
        if (error) {
          console.error("Update product error:", error);
          alert(error.message || "Failed to update product");
          return;
        }
      } else {
        const { error } = await supabase.from("products").insert(payload);
        if (error) {
          console.error("Insert product error:", error);
          alert(error.message || "Failed to create product");
          return;
        }
      }

      setModalOpen(false);
      resetForm();
      void loadProductsAndBalances();
    } catch (err) {
      console.error("Unexpected product save error:", err);
      alert("Unexpected error saving product. Check console for details.");
    }
  }

  async function toggleActive(product: Product) {
    if (readOnly) return;
    await supabase.from("products").update({ active: !product.active }).eq("id", product.id);
    void loadProductsAndBalances();
  }

  const filteredProducts = products.filter((p) => (p.name || "").toLowerCase().includes(search.toLowerCase()));

  const getDepartmentName = (departmentId: string | null) => {
    if (!departmentId) return "—";
    const dep = departments.find((d) => d.id === departmentId);
    return dep?.name || "—";
  };

  const formMargin = marginFromPrices(formData.cost_price, formData.sales_price);
  const showFormMargin =
    formData.sales_price > 0 && formData.cost_price >= 0 && Number.isFinite(formData.cost_price) && Number.isFinite(formData.sales_price);

  return (
    <div className="p-6 md:p-8">
      {readOnly && <ReadOnlyNotice />}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold text-slate-900">Products</h1>
            <PageNotes ariaLabel="Products help">
              <p>Inventory items, pricing, and stock levels.</p>
            </PageNotes>
          </div>
        </div>
        <button
          type="button"
          onClick={openNewItem}
          disabled={readOnly}
          className="inline-flex items-center gap-2 bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium"
        >
          <Plus className="w-5 h-5" />
          New item
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          placeholder="Search products…"
          className="border border-slate-300 rounded-lg px-3 py-2 flex-1 max-w-md"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[1000px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left p-3">Product</th>
              <th className="text-left p-3">Department</th>
              <th className="text-right p-3 whitespace-nowrap">Reorder level</th>
              <th className="text-right p-3 whitespace-nowrap">Current balance</th>
              <th className="text-right p-3 whitespace-nowrap">Cost price</th>
              <th className="text-right p-3 whitespace-nowrap">Sales price</th>
              <th className="text-right p-3 whitespace-nowrap">Margin</th>
              <th className="text-center p-3">Active</th>
              <th className="text-right p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map((product) => {
              const track = product.track_inventory !== false;
              const bal = balanceByProduct[product.id];
              const m = marginFromPrices(product.cost_price, product.sales_price);
              const rl = product.reorder_level;
              return (
                <tr key={product.id} className="border-t border-slate-100">
                  <td className="p-3 font-medium">{product.name}</td>
                  <td className="p-3 text-slate-700">{getDepartmentName(product.department_id ?? null)}</td>
                  <td className="p-3 text-right tabular-nums">{rl != null && rl !== undefined ? fmtMoney(Number(rl)) : "—"}</td>
                  <td className="p-3 text-right tabular-nums">{track ? fmtMoney(bal ?? 0) : "—"}</td>
                  <td className="p-3 text-right tabular-nums">{fmtMoney(Number(product.cost_price ?? 0))}</td>
                  <td className="p-3 text-right tabular-nums">{fmtMoney(Number(product.sales_price ?? 0))}</td>
                  <td className="p-3 text-right tabular-nums text-slate-800">
                    {m ? (
                      <>
                        {fmtMoney(m.amount)}
                        <span className="text-slate-500 text-xs ml-1">({m.pct.toFixed(1)}%)</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="p-3 text-center">
                    {product.active ? (
                      <CheckCircle className="text-green-600 inline-block w-5 h-5" />
                    ) : (
                      <XCircle className="text-red-600 inline-block w-5 h-5" />
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => editProduct(product)}
                        disabled={readOnly}
                        className="p-1.5 text-brand-700 hover:bg-brand-50 rounded disabled:opacity-50"
                        title="Edit"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleActive(product)}
                        disabled={readOnly}
                        className="text-xs text-slate-600 hover:underline disabled:opacity-50"
                      >
                        {product.active ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filteredProducts.length === 0 && (
          <p className="p-8 text-center text-slate-500">No products match your search.</p>
        )}
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => !readOnly && setModalOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-slate-900">{editingProduct ? "Edit product" : "New item"}</h2>
              <button
                type="button"
                onClick={() => {
                  setModalOpen(false);
                  resetForm();
                }}
                className="p-1 rounded hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Product name *</label>
                <input
                  className="w-full border border-slate-300 rounded-lg px-3 py-2"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Product name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Cost price</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2"
                  value={formData.cost_price}
                  onChange={(e) => setFormData({ ...formData, cost_price: Number(e.target.value) || 0 })}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Sales price</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2"
                  value={formData.sales_price}
                  onChange={(e) => setFormData({ ...formData, sales_price: Number(e.target.value) || 0 })}
                />
              </div>

              {showFormMargin && formMargin && (
                <div className="md:col-span-2 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm">
                  <p className="font-semibold text-emerald-900 mb-1">Margin</p>
                  <p className="text-emerald-800">
                    <span className="text-slate-600">Amount:</span> {fmtMoney(formMargin.amount)} &nbsp;|&nbsp;
                    <span className="text-slate-600">Gross % of sales:</span> {formMargin.pct.toFixed(1)}%
                  </p>
                  <p className="text-xs text-emerald-700 mt-1">Shown after cost and sales price are entered (sales price &gt; 0).</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Reorder level</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2"
                  value={formData.reorder_level}
                  onChange={(e) => setFormData({ ...formData, reorder_level: e.target.value })}
                  placeholder="Optional minimum qty"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Department</label>
                <select
                  className="w-full border border-slate-300 rounded-lg px-3 py-2"
                  value={formData.department_id}
                  onChange={(e) => setFormData({ ...formData, department_id: e.target.value })}
                >
                  <option value="">Select department</option>
                  {departments.map((dep) => (
                    <option key={dep.id} value={dep.id}>
                      {dep.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Sales account</label>
                <select
                  className="w-full border border-slate-300 rounded-lg px-3 py-2"
                  value={formData.income_account}
                  onChange={(e) => setFormData({ ...formData, income_account: e.target.value })}
                >
                  <option value="">Select sales account</option>
                  {glAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.account_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Purchases account</label>
                <select
                  className="w-full border border-slate-300 rounded-lg px-3 py-2"
                  value={formData.purchases_account}
                  onChange={(e) => setFormData({ ...formData, purchases_account: e.target.value })}
                >
                  <option value="">Select purchases account</option>
                  {glAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.account_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Stock account</label>
                <select
                  className="w-full border border-slate-300 rounded-lg px-3 py-2"
                  value={formData.stock_account}
                  onChange={(e) => setFormData({ ...formData, stock_account: e.target.value })}
                >
                  <option value="">Select stock account</option>
                  {glAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.account_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2 flex flex-wrap items-center gap-4 pt-1">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={formData.purchasable}
                    onChange={(e) => setFormData({ ...formData, purchasable: e.target.checked })}
                  />
                  Purchasable
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={formData.saleable}
                    onChange={(e) => setFormData({ ...formData, saleable: e.target.checked })}
                  />
                  Saleable
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={formData.track_inventory}
                    onChange={(e) => setFormData({ ...formData, track_inventory: e.target.checked })}
                  />
                  Track inventory
                </label>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                <select
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 max-w-xs"
                  value={formData.active ? "true" : "false"}
                  onChange={(e) => setFormData({ ...formData, active: e.target.value === "true" })}
                >
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button
                type="button"
                onClick={() => void saveProduct()}
                disabled={readOnly}
                className="inline-flex items-center gap-2 bg-brand-700 text-white px-4 py-2 rounded-lg hover:bg-brand-800 disabled:opacity-50"
              >
                <Save size={18} /> {editingProduct ? "Save changes" : "Save product"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setModalOpen(false);
                  resetForm();
                }}
                className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
