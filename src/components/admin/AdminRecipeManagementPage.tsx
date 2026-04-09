import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, ChefHat } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import { PageNotes } from "../common/PageNotes";

interface Product {
  id: string;
  name: string;
  saleable?: boolean | null;
  track_inventory?: boolean | null;
}

interface RecipeItemRow {
  id: string;
  product_id: string;
  ingredient_product_id: string;
  quantity_per_unit: number;
}

export function AdminRecipeManagementPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [products, setProducts] = useState<Product[]>([]);
  const [rows, setRows] = useState<RecipeItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [menuProductId, setMenuProductId] = useState("");
  const [ingredientProductId, setIngredientProductId] = useState("");
  const [qtyPerUnit, setQtyPerUnit] = useState("1");
  const [menuSearch, setMenuSearch] = useState("");
  const [ingredientSearch, setIngredientSearch] = useState("");
  const [configuredSearch, setConfiguredSearch] = useState("");
  const [editingQtyByRowId, setEditingQtyByRowId] = useState<Record<string, string>>({});

  useEffect(() => {
    loadData();
  }, [orgId, superAdmin]);

  const productNameMap = useMemo(
    () => Object.fromEntries(products.map((p) => [p.id, p.name])),
    [products]
  );

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const recipeQuery = (supabase as any)
        .from("product_recipe_items")
        .select("id,product_id,ingredient_product_id,quantity_per_unit")
        .order("created_at", { ascending: false });
      const richProducts = await filterByOrganizationId(
        supabase.from("products").select("id,name,saleable,track_inventory").order("name"),
        orgId,
        superAdmin
      );

      const productsRes =
        richProducts.error
          ? await filterByOrganizationId(supabase.from("products").select("id,name").order("name"), orgId, superAdmin)
          : richProducts;

      const [recipeRes] = await Promise.all([recipeQuery]);

      if (productsRes.error) throw productsRes.error;
      setProducts((productsRes.data || []) as Product[]);

      if (recipeRes.error) {
        const msg = String(recipeRes.error.message || "");
        setError(
          msg.toLowerCase().includes("does not exist")
            ? 'Recipe table missing. Create table "product_recipe_items" first in your database.'
            : msg
        );
        setRows([]);
      } else {
        setRows((recipeRes.data || []) as RecipeItemRow[]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load recipe data.");
    } finally {
      setLoading(false);
    }
  };

  const saveRecipeItem = async () => {
    if (!menuProductId || !ingredientProductId) {
      alert("Select both menu item and ingredient.");
      return;
    }
    if (menuProductId === ingredientProductId) {
      alert("Menu item and ingredient cannot be the same.");
      return;
    }
    const qty = Number(qtyPerUnit);
    if (!qty || qty <= 0) {
      alert("Enter a quantity per unit greater than 0.");
      return;
    }

    setSaving(true);
    try {
      const { error: upsertErr } = await (supabase as any)
        .from("product_recipe_items")
        .upsert(
          {
            product_id: menuProductId,
            ingredient_product_id: ingredientProductId,
            quantity_per_unit: qty,
          },
          { onConflict: "product_id,ingredient_product_id" }
        );
      if (upsertErr) throw upsertErr;

      setIngredientProductId("");
      setQtyPerUnit("1");
      await loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to save recipe item.");
    } finally {
      setSaving(false);
    }
  };

  const saveInlineQty = async (line: RecipeItemRow) => {
    const raw = (editingQtyByRowId[line.id] ?? String(line.quantity_per_unit)).trim();
    const qty = Number(raw);
    if (!qty || qty <= 0) {
      alert("Quantity per unit must be greater than 0.");
      return;
    }
    const { error: updErr } = await (supabase as any)
      .from("product_recipe_items")
      .update({ quantity_per_unit: qty })
      .eq("id", line.id);
    if (updErr) {
      alert(updErr.message || "Failed to update quantity.");
      return;
    }
    setRows((prev) =>
      prev.map((r) => (r.id === line.id ? { ...r, quantity_per_unit: qty } : r))
    );
  };

  const deleteRecipeItem = async (id: string) => {
    if (!confirm("Delete this recipe line?")) return;
    const { error: delErr } = await (supabase as any)
      .from("product_recipe_items")
      .delete()
      .eq("id", id);
    if (delErr) {
      alert(delErr.message);
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const grouped = useMemo(() => {
    const map: Record<string, RecipeItemRow[]> = {};
    rows.forEach((r) => {
      const menuName = (productNameMap[r.product_id] || "").toLowerCase();
      const ingName = (productNameMap[r.ingredient_product_id] || "").toLowerCase();
      const q = configuredSearch.trim().toLowerCase();
      if (q && !menuName.includes(q) && !ingName.includes(q)) return;
      if (!map[r.product_id]) map[r.product_id] = [];
      map[r.product_id].push(r);
    });
    return map;
  }, [rows, configuredSearch, productNameMap]);

  const menuOptions = useMemo(() => {
    const q = menuSearch.trim().toLowerCase();
    return products.filter((p) => {
      const saleable = p.saleable ?? true;
      if (!saleable) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q);
    });
  }, [products, menuSearch]);

  const ingredientOptions = useMemo(() => {
    const q = ingredientSearch.trim().toLowerCase();
    return products.filter((p) => {
      const tracked = p.track_inventory ?? true;
      if (!tracked) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q);
    });
  }, [products, ingredientSearch]);

  if (loading) {
    return <div className="text-slate-500 py-8">Loading recipes...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <ChefHat className="w-5 h-5 text-slate-700 shrink-0" />
          <h2 className="text-lg font-semibold text-slate-900">Recipe Management</h2>
          <PageNotes ariaLabel="Recipe management help">
            <p>Link each sellable menu item to ingredient products consumed per unit sale.</p>
          </PageNotes>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <label className="block text-xs text-slate-600 mb-1">Menu Item</label>
            <input
              value={menuSearch}
              onChange={(e) => setMenuSearch(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2"
              placeholder="Search sellable products..."
            />
            <select
              value={menuProductId}
              onChange={(e) => setMenuProductId(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Select menu item</option>
              {menuOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Ingredient</label>
            <input
              value={ingredientSearch}
              onChange={(e) => setIngredientSearch(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2"
              placeholder="Search inventory items..."
            />
            <select
              value={ingredientProductId}
              onChange={(e) => setIngredientProductId(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Select ingredient</option>
              {ingredientOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Qty / unit</label>
            <div className="flex gap-2">
              <input
                type="number"
                min="0.0001"
                step="0.0001"
                value={qtyPerUnit}
                onChange={(e) => setQtyPerUnit(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={saveRecipeItem}
                disabled={saving}
                className="app-btn-primary gap-1 px-3 py-2 text-sm"
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 text-sm">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center gap-3 justify-between">
          <h3 className="font-semibold text-slate-900">Configured Recipes</h3>
          <input
            value={configuredSearch}
            onChange={(e) => setConfiguredSearch(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm min-w-[220px]"
            placeholder="Filter by menu or ingredient..."
          />
        </div>
        {Object.keys(grouped).length === 0 ? (
          <p className="text-sm text-slate-500 p-4">No recipe lines yet.</p>
        ) : (
          <div className="divide-y divide-slate-200">
            {Object.entries(grouped).map(([productId, recipeLines]) => (
              <div key={productId} className="p-4">
                <p className="font-semibold text-slate-900 mb-2">
                  {productNameMap[productId] || productId}
                </p>
                <div className="space-y-2">
                  {recipeLines.map((line) => (
                    <div
                      key={line.id}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <p className="text-slate-700 flex-1">
                        {productNameMap[line.ingredient_product_id] || line.ingredient_product_id}
                      </p>
                      <input
                        type="number"
                        min="0.0001"
                        step="0.0001"
                        value={editingQtyByRowId[line.id] ?? String(line.quantity_per_unit)}
                        onChange={(e) =>
                          setEditingQtyByRowId((prev) => ({
                            ...prev,
                            [line.id]: e.target.value,
                          }))
                        }
                        className="w-28 border border-slate-300 rounded px-2 py-1 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => saveInlineQty(line)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteRecipeItem(line.id)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
