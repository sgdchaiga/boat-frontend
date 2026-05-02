import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Edit,
  Plus,
  Save,
  X,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import type { Database } from "../lib/database.types";
import { ReadOnlyNotice } from "./common/ReadOnlyNotice";
import { PageNotes } from "./common/PageNotes";

type Product = Database["public"]["Tables"]["products"]["Row"];
type Department = Database["public"]["Tables"]["departments"]["Row"];
type GlAccountOption = {
  id: string;
  account_code: string;
  account_name: string;
  is_active: boolean;
  account_type?: string;
};

type ItemKind = "product" | "service";

const LAST_BUY_PRICE_KEY = "boat.items.last_buy_price";
const LAST_SELL_PRICE_KEY = "boat.items.last_sell_price";

function readStoredPrice(key: string): number {
  try {
    const n = parseFloat(localStorage.getItem(key) ?? "");
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeStoredPrice(key: string, value: number) {
  try {
    if (value > 0) localStorage.setItem(key, String(value));
  } catch {
    /* ignore */
  }
}

/** Infer default GL postings when the user leaves accounting on auto. */
function resolveProductGlSuggestions(accounts: GlAccountOption[]): {
  income: string;
  purchases: string;
  stock: string;
} {
  const txt = (a: GlAccountOption) =>
    `${a.account_code} ${a.account_name}`.toLowerCase();

  const pick = (predicate: (a: GlAccountOption) => boolean) =>
    accounts.find(predicate)?.id ?? "";

  const income =
    pick((a) => /\b(income|revenue|sales of|retail sales)\b/i.test(a.account_name)) ||
    pick((a) => /sales|revenue|income/.test(txt(a)));

  const purchases =
    pick((a) => /\b(cost of sales|cogs|cost of goods|purchases)\b/i.test(a.account_name)) ||
    pick((a) => /cogs|cost of goods|purchases?/.test(txt(a)));

  const stock =
    pick((a) => /\b(inventory|stock on hand|merchandise)\b/i.test(a.account_name)) ||
    pick((a) => /\binventory\b|\bstock\b/.test(txt(a)));

  return { income, purchases, stock };
}

interface ProductsPageProps {
  readOnly?: boolean;
}

function fmtMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtQty(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  return Number.isInteger(v) ? String(v) : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
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
  const [glAccounts, setGlAccounts] = useState<GlAccountOption[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [itemKind, setItemKind] = useState<ItemKind>("product");
  const [showAdvanced, setShowAdvanced] = useState(false);

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
      supabase.from("products").select("*"),
      supabase.from("product_stock_movements").select("product_id,quantity_in,quantity_out"),
    ]);

    if (prodRes.error) {
      console.error(prodRes.error);
      return;
    }
    const list = ((prodRes.data || []) as Product[]).sort((a, b) =>
      (a.name || "").localeCompare(b.name || "")
    );
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
    const { data, error } = await supabase.from("gl_accounts").select("*");
    if (error) {
      console.error("Failed to load GL accounts:", error);
      setGlAccounts([]);
      return;
    }
    if (!data) return;
    const normalized = (data as Array<Record<string, unknown>>)
      .map((row) => ({
        id: String(row.id ?? ""),
        account_code: String(row.account_code ?? row.code ?? ""),
        account_name: String(row.account_name ?? row.name ?? ""),
        account_type: row.account_type != null ? String(row.account_type) : undefined,
        is_active:
          row.is_active === false || row.is_active === 0 || row.is_active === "0"
            ? false
            : true,
      }))
      .filter((row) => row.id)
      .sort((a, b) =>
        `${a.account_code} ${a.account_name}`.localeCompare(`${b.account_code} ${b.account_name}`)
      );
    setGlAccounts(normalized);
  }

  async function loadDepartments() {
    const { data } = await supabase.from("departments").select("*");
    if (data) {
      setDepartments(
        [...data].sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      );
    }
  }

  const glSuggestions = useMemo(() => resolveProductGlSuggestions(glAccounts), [glAccounts]);

  function resetForm() {
    setEditingProduct(null);
    setItemKind("product");
    setShowAdvanced(false);
    setFormData({
      name: "",
      cost_price: readStoredPrice(LAST_BUY_PRICE_KEY),
      sales_price: readStoredPrice(LAST_SELL_PRICE_KEY),
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
    const track = product.track_inventory !== false;
    setItemKind(track ? "product" : "service");
    setShowAdvanced(false);
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
      track_inventory: track,
      active: product.active ?? true,
    });
    setModalOpen(true);
  }

  async function saveProduct() {
    if (readOnly) {
      alert("Subscription inactive: Items is in read-only mode.");
      return;
    }

    if (!formData.name.trim()) {
      alert("Please enter an item name.");
      return;
    }

    if (formData.saleable && (!formData.sales_price || formData.sales_price <= 0)) {
      alert("Items that are sold need a selling price greater than zero.");
      return;
    }

    const reorderParsed =
      formData.reorder_level.trim() === "" ? null : Number(formData.reorder_level);
    if (reorderParsed != null && (Number.isNaN(reorderParsed) || reorderParsed < 0)) {
      alert("Low stock alert must be zero or a positive number.");
      return;
    }

    const trackStock = itemKind === "product" && formData.track_inventory;

    const incomeId = (formData.income_account.trim() || glSuggestions.income || "") || null;
    const stockId =
      (trackStock ? formData.stock_account.trim() || glSuggestions.stock || "" : "") || null;
    const purchasesId =
      (formData.purchasable
        ? formData.purchases_account.trim() || glSuggestions.purchases || ""
        : "") || null;

    const payload = {
      name: formData.name.trim(),
      cost_price: formData.cost_price,
      sales_price: formData.sales_price,
      reorder_level: reorderParsed,
      department_id: formData.department_id || null,
      income_account: incomeId,
      stock_account: stockId,
      purchases_account: purchasesId,
      purchasable: formData.purchasable,
      saleable: formData.saleable,
      track_inventory: trackStock,
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

      writeStoredPrice(LAST_BUY_PRICE_KEY, formData.cost_price);
      writeStoredPrice(LAST_SELL_PRICE_KEY, formData.sales_price);

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
            <h1 className="text-3xl font-bold text-slate-900">Items</h1>
            <PageNotes ariaLabel="Items help">
              <p>
                Items you sell or buy — simplified pricing and stock. Default accounts map from your chart; open{" "}
                <strong className="font-medium text-slate-800">Advanced</strong> only if your accountant chose custom GL mappings.
              </p>
            </PageNotes>
          </div>
          <p className="text-sm text-slate-500 mt-1">Products you sell or buy</p>
        </div>
        <button
          type="button"
          onClick={openNewItem}
          disabled={readOnly}
          className="inline-flex items-center gap-2 bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium"
        >
          <Plus className="w-5 h-5" />
          Add item
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          placeholder="Search item name..."
          className="border border-slate-300 rounded-lg px-3 py-2 flex-1 max-w-md"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search items"
        />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left p-3">Item</th>
              <th className="text-right p-3 whitespace-nowrap">Stock</th>
              <th className="text-right p-3 whitespace-nowrap">Buy price</th>
              <th className="text-right p-3 whitespace-nowrap">Sell price</th>
              <th className="text-right p-3 whitespace-nowrap">Profit</th>
              <th className="text-left p-3 whitespace-nowrap">Status</th>
              <th className="text-right p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map((product) => {
              const track = product.track_inventory !== false;
              const bal = balanceByProduct[product.id];
              const m = marginFromPrices(product.cost_price, product.sales_price);
              const rl = product.reorder_level;
              const rlNum = rl != null && rl !== undefined ? Number(rl) : null;
              const isLow =
                track &&
                rlNum != null &&
                Number.isFinite(rlNum) &&
                (bal ?? 0) <= rlNum;

              return (
                <tr key={product.id} className={`border-t border-slate-100 ${isLow ? "bg-amber-50/60" : ""}`}>
                  <td className="p-3 font-medium max-w-[14rem] truncate" title={product.name}>
                    {product.name}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {track ? (
                      <span className={isLow ? "text-amber-900 font-medium" : ""}>
                        {fmtQty(bal ?? 0)}
                        {isLow ? <span className="ml-1.5 text-amber-800 text-xs font-normal whitespace-nowrap">⚠ Low</span> : null}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="p-3 text-right tabular-nums">{fmtMoney(Number(product.cost_price ?? 0))}</td>
                  <td className="p-3 text-right tabular-nums">{fmtMoney(Number(product.sales_price ?? 0))}</td>
                  <td className="p-3 text-right tabular-nums text-slate-800">
                    {m ? (
                      <>
                        {fmtMoney(m.amount)}
                        <span className="text-slate-500 text-xs ml-1 whitespace-nowrap">(+{m.pct.toFixed(0)}%)</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="p-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        product.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      {product.active ? "Active" : "Inactive"}
                    </span>
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
          <p className="p-8 text-center text-slate-500">No items match your search.</p>
        )}
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => !readOnly && setModalOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-slate-900">{editingProduct ? "Edit item" : "Add item"}</h2>
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

            <fieldset className="space-y-4 border-0 p-0 m-0">
              <legend className="sr-only">Item details</legend>

              <div>
                <h3 className="text-sm font-semibold text-slate-800 border-b border-slate-200 pb-2 mb-3">Basic info</h3>
                <p className="text-sm font-medium text-slate-700 mb-2">What are you adding?</p>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="itemKind"
                      className="h-4 w-4"
                      checked={itemKind === "product"}
                      onChange={() => {
                        setItemKind("product");
                        setFormData((prev) => ({ ...prev, track_inventory: true }));
                      }}
                    />
                    Product (stock item)
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="itemKind"
                      className="h-4 w-4"
                      checked={itemKind === "service"}
                      onChange={() => {
                        setItemKind("service");
                        setFormData((prev) => ({ ...prev, track_inventory: false }));
                      }}
                    />
                    Service (no stock)
                  </label>
                </div>
                <label className="block text-sm font-medium text-slate-700 mt-4 mb-1">Item name *</label>
                <input
                  className="w-full border border-slate-300 rounded-lg px-3 py-2"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Coca Cola 500ml"
                />
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-800 border-b border-slate-200 pb-2 mb-3">Pricing</h3>
                <div className="flex flex-wrap gap-4 mb-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={formData.purchasable}
                      onChange={(e) => setFormData({ ...formData, purchasable: e.target.checked })}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    This item is bought
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={formData.saleable}
                      onChange={(e) => setFormData({ ...formData, saleable: e.target.checked })}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    This item is sold
                  </label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Buying price <span className="text-slate-500 font-normal">(optional)</span>
                    </label>
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
                    <label className="block text-sm font-medium text-slate-700 mb-1">Selling price</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2"
                      value={formData.sales_price}
                      onChange={(e) => setFormData({ ...formData, sales_price: Number(e.target.value) || 0 })}
                    />
                  </div>
                </div>
                {showFormMargin && formMargin ? (
                  <p className="mt-3 text-sm text-slate-700">
                    <span className="font-medium text-slate-800">Profit per item:</span>{" "}
                    <span className="tabular-nums">{fmtMoney(formMargin.amount)}</span>
                    <span className="text-slate-500 text-xs ml-1">(+{formMargin.pct.toFixed(0)}%)</span>
                  </p>
                ) : null}
              </div>

              {itemKind === "product" ? (
                <div>
                  <h3 className="text-sm font-semibold text-slate-800 border-b border-slate-200 pb-2 mb-3">Stock</h3>
                  <label className="flex items-center gap-2 text-sm mb-3">
                    <input
                      type="checkbox"
                      checked={formData.track_inventory}
                      onChange={(e) => setFormData({ ...formData, track_inventory: e.target.checked })}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    Track stock
                  </label>
                  {formData.track_inventory ? (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Low stock alert</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 max-w-xs"
                        value={formData.reorder_level}
                        onChange={(e) => setFormData({ ...formData, reorder_level: e.target.value })}
                        placeholder="Optional — warn when at or below this qty"
                      />
                      <p className="text-xs text-slate-500 mt-1">You’ll see a warning in the list when stock is at or below this level.</p>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-slate-500">Services don’t use stock counts.</p>
              )}

              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-slate-900"
                >
                  {showAdvanced ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  Advanced (optional)
                </button>
                {showAdvanced ? (
                  <div className="mt-3 space-y-3 pl-1 border-l-2 border-slate-200 pl-4">
                    <p className="text-xs text-slate-500">
                      Leave accounts on <strong className="font-medium text-slate-600">Automatic</strong> unless your chart needs a
                      specific mapping.
                    </p>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Category / department</label>
                      <select
                        className="w-full border border-slate-300 rounded-lg px-3 py-2"
                        value={formData.department_id}
                        onChange={(e) => setFormData({ ...formData, department_id: e.target.value })}
                      >
                        <option value="">—</option>
                        {departments.map((dep) => (
                          <option key={dep.id} value={dep.id}>
                            {dep.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Sales (income) account</label>
                      <select
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                        value={formData.income_account}
                        onChange={(e) => setFormData({ ...formData, income_account: e.target.value })}
                      >
                        <option value="">Automatic (recommended)</option>
                        {glAccounts.map((acc) => (
                          <option key={acc.id} value={acc.id}>
                            {[acc.account_code, acc.account_name].filter(Boolean).join(" — ") || "Unnamed account"}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Purchases / cost account</label>
                      <select
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                        value={formData.purchases_account}
                        onChange={(e) => setFormData({ ...formData, purchases_account: e.target.value })}
                      >
                        <option value="">Automatic (recommended)</option>
                        {glAccounts.map((acc) => (
                          <option key={acc.id} value={acc.id}>
                            {[acc.account_code, acc.account_name].filter(Boolean).join(" — ") || "Unnamed account"}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Stock (inventory) account</label>
                      <select
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                        value={formData.stock_account}
                        onChange={(e) => setFormData({ ...formData, stock_account: e.target.value })}
                      >
                        <option value="">Automatic (recommended)</option>
                        {glAccounts.map((acc) => (
                          <option key={acc.id} value={acc.id}>
                            {[acc.account_code, acc.account_name].filter(Boolean).join(" — ") || "Unnamed account"}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : null}
              </div>
            </fieldset>

            <div className="mt-4">
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

            <div className="flex flex-wrap gap-2 mt-8">
              <button
                type="button"
                onClick={() => void saveProduct()}
                disabled={readOnly}
                className="inline-flex items-center gap-2 bg-brand-700 text-white px-4 py-2 rounded-lg hover:bg-brand-800 disabled:opacity-50"
              >
                <Save size={18} /> Save
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
