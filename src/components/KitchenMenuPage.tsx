import { useCallback, useEffect, useMemo, useState } from "react";
import { ChefHat, Loader2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { Database } from "../lib/database.types";
import { useAuth } from "../contexts/AuthContext";
import { filterByOrganizationId } from "../lib/supabaseOrgFilter";
import { PageNotes } from "./common/PageNotes";
import { ReadOnlyNotice } from "./common/ReadOnlyNotice";
import { effectivePosCatalogMode } from "../lib/posCatalogMode";

type Department = Database["public"]["Tables"]["departments"]["Row"];

type MenuProduct = {
  id: string;
  name: string;
  sales_price: number | null;
  track_inventory: boolean | null;
  department_id: string | null;
};

type RecipeLine = {
  product_id: string;
  ingredient_product_id: string;
  quantity_per_unit: number;
};

export interface KitchenMenuPageProps {
  readOnly?: boolean;
  onNavigate?: (page: string, state?: Record<string, unknown>) => void;
}

export function KitchenMenuPage({ readOnly = false, onNavigate }: KitchenMenuPageProps) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [menuProducts, setMenuProducts] = useState<MenuProduct[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [recipeLines, setRecipeLines] = useState<RecipeLine[]>([]);
  const [ingredientNameById, setIngredientNameById] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const deptRes = await filterByOrganizationId(
        supabase.from("departments").select("id,name,pos_catalog_mode").order("name"),
        orgId,
        superAdmin
      );
      if (deptRes.error) throw deptRes.error;
      const deptRows = (deptRes.data || []) as Department[];
      setDepartments(deptRows);

      const dishDeptIds = new Set(
        deptRows.filter((d) => effectivePosCatalogMode(d) === "dish_menu").map((d) => d.id)
      );

      if (dishDeptIds.size === 0) {
        setMenuProducts([]);
        setRecipeLines([]);
        setIngredientNameById({});
        setLoading(false);
        return;
      }

      const prodRes = await filterByOrganizationId(
        supabase
          .from("products")
          .select("id,name,sales_price,track_inventory,department_id,active,saleable")
          .eq("active", true)
          .eq("saleable", true)
          .order("name"),
        orgId,
        superAdmin
      );
      if (prodRes.error) throw prodRes.error;

      const allProds = (prodRes.data || []) as MenuProduct & { active?: boolean; saleable?: boolean }[];
      const dishes = allProds.filter((p) => p.department_id && dishDeptIds.has(p.department_id));
      setMenuProducts(dishes);

      const dishIds = dishes.map((p) => p.id);
      if (dishIds.length === 0) {
        setRecipeLines([]);
        setIngredientNameById({});
        setLoading(false);
        return;
      }

      const { data: rData, error: rErr } = await (supabase as any)
        .from("product_recipe_items")
        .select("product_id,ingredient_product_id,quantity_per_unit")
        .in("product_id", dishIds);

      if (rErr) {
        const msg = String(rErr.message || "").toLowerCase();
        if (!msg.includes("does not exist") && !msg.includes("not found")) {
          throw rErr;
        }
        setRecipeLines([]);
        setIngredientNameById({});
        setLoading(false);
        return;
      }

      const rows = (rData || []) as RecipeLine[];
      setRecipeLines(rows);

      const ingIds = [...new Set(rows.map((r) => r.ingredient_product_id).filter(Boolean))];
      if (ingIds.length === 0) {
        setIngredientNameById({});
        setLoading(false);
        return;
      }

      const ingRes = await filterByOrganizationId(
        supabase.from("products").select("id,name").in("id", ingIds),
        orgId,
        superAdmin
      );
      if (ingRes.error) throw ingRes.error;
      const map: Record<string, string> = {};
      ((ingRes.data || []) as { id: string; name: string }[]).forEach((p) => {
        map[p.id] = p.name;
      });
      setIngredientNameById(map);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load kitchen menu.");
      setMenuProducts([]);
      setRecipeLines([]);
      setIngredientNameById({});
    } finally {
      setLoading(false);
    }
  }, [orgId, superAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const deptNameById = useMemo(
    () => Object.fromEntries(departments.map((d) => [d.id, d.name])),
    [departments]
  );

  const recipeByDishId = useMemo(() => {
    const m: Record<string, RecipeLine[]> = {};
    for (const line of recipeLines) {
      if (!m[line.product_id]) m[line.product_id] = [];
      m[line.product_id].push(line);
    }
    for (const k of Object.keys(m)) {
      m[k].sort((a, b) => {
        const na = ingredientNameById[a.ingredient_product_id] || "";
        const nb = ingredientNameById[b.ingredient_product_id] || "";
        return na.localeCompare(nb);
      });
    }
    return m;
  }, [recipeLines, ingredientNameById]);

  const dishDeptCount = useMemo(
    () => departments.filter((d) => effectivePosCatalogMode(d) === "dish_menu").length,
    [departments]
  );

  const stockTextForDish = (dish: MenuProduct): { lines: string[]; hint?: string } => {
    const rules = recipeByDishId[dish.id] || [];
    if (rules.length > 0) {
      return {
        lines: rules.map(
          (r) =>
            `${Number(r.quantity_per_unit)}× ${ingredientNameById[r.ingredient_product_id] || r.ingredient_product_id}`
        ),
      };
    }
    if (dish.track_inventory === true) {
      return {
        lines: [`${dish.name} (same SKU — menu item stock)`],
        hint: "No recipe: inventory reduces on the menu product itself.",
      };
    }
    return {
      lines: [],
      hint: "Add a recipe so ingredient products reduce, or enable inventory on this menu item.",
    };
  };

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-8">
      <div className="flex flex-wrap items-start gap-4 justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="bg-amber-100 p-3 rounded-xl">
            <ChefHat className="w-7 h-7 text-amber-800" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Kitchen menu</h1>
            <p className="text-slate-600 text-sm mt-1">
              Menu items (dishes) and the inventory products whose stock decreases when sold — separate from bar/retail
              products.
            </p>
          </div>
        </div>
        {!readOnly && onNavigate ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onNavigate("admin", { adminTab: "products" })}
              className="text-sm px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50"
            >
              Departments & menu setup
            </button>
            <button
              type="button"
              onClick={() => onNavigate("admin", { adminTab: "recipes" })}
              className="text-sm px-3 py-2 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
            >
              Recipe management
            </button>
          </div>
        ) : null}
      </div>

      {readOnly ? <ReadOnlyNotice /> : null}

      <PageNotes ariaLabel="Kitchen menu help">
        <p>
          Only products in departments marked <strong>Kitchen menu (dishes)</strong> appear here — not bar, sauna, or
          other retail SKUs.
        </p>
        <p className="mt-2">
          <strong>Stock products</strong> are the ingredient items linked in Recipe management (what actually reduces in
          stock). If there is no recipe, the POS may still reduce stock on the menu item itself when it tracks
          inventory.
        </p>
      </PageNotes>

      {error ? (
        <p className="text-red-600 text-sm mt-4">{error}</p>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-600 mt-8">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading kitchen menu…
        </div>
      ) : dishDeptCount === 0 ? (
        <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50 px-4 py-6 text-amber-950 text-sm">
          <p className="font-medium">No kitchen menu departments yet.</p>
          <p className="mt-2">
            In <strong>Admin → Products → Departments</strong>, set <strong>POS list</strong> to{" "}
            <em>Kitchen menu (dishes)</em> for departments that hold your dishes. Bar and sauna departments should stay{" "}
            <em>Bar / retail</em> so they never appear on this page.
          </p>
        </div>
      ) : menuProducts.length === 0 ? (
        <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-slate-700 text-sm">
          <p>No active menu items in kitchen departments. Add products under a department with POS list = Kitchen menu.</p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left">
                <th className="py-3 px-4 font-semibold text-slate-800">Menu item</th>
                <th className="py-3 px-4 font-semibold text-slate-800">Department</th>
                <th className="py-3 px-4 font-semibold text-slate-800 text-right">Price</th>
                <th className="py-3 px-4 font-semibold text-slate-800 min-w-[14rem]">
                  Stock products (inventory reduces)
                </th>
              </tr>
            </thead>
            <tbody>
              {menuProducts.map((dish) => {
                const st = stockTextForDish(dish);
                return (
                  <tr key={dish.id} className="border-b border-slate-100 last:border-0 align-top">
                    <td className="py-3 px-4 font-medium text-slate-900">{dish.name}</td>
                    <td className="py-3 px-4 text-slate-600">
                      {dish.department_id ? deptNameById[dish.department_id] ?? "—" : "—"}
                    </td>
                    <td className="py-3 px-4 text-right tabular-nums text-slate-800">
                      {dish.sales_price != null ? Number(dish.sales_price).toFixed(2) : "—"}
                    </td>
                    <td className="py-3 px-4 text-slate-800">
                      {st.lines.length > 0 ? (
                        <ul className="list-disc pl-5 space-y-0.5">
                          {st.lines.map((line, i) => (
                            <li key={i}>{line}</li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-amber-800">—</span>
                      )}
                      {st.hint ? <p className="text-xs text-slate-500 mt-1.5">{st.hint}</p> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
