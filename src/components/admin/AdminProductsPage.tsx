import { useEffect, useState } from "react";
import { Plus, Edit2, Trash2, Layers } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";

type PosCatalogMode = "dish_menu" | "product_catalog";

interface Department {
  id: string;
  name: string;
  pos_catalog_mode?: PosCatalogMode | null;
}

interface Product {
  id: string;
  name: string;
  sales_price: number;
  cost_price?: number;
  department_id: string | null;
  barcode?: string | null;
  active?: boolean;
  departments?: { name: string } | null;
}

export function AdminProductsPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [departments, setDepartments] = useState<Department[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<"departments" | "products">(
    "departments"
  );

  // Department form
  const [showDeptModal, setShowDeptModal] = useState(false);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [deptName, setDeptName] = useState("");
  const [deptPosCatalog, setDeptPosCatalog] = useState<PosCatalogMode>("product_catalog");

  // Product form
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productName, setProductName] = useState("");
  const [productSalesPrice, setProductSalesPrice] = useState("");
  const [productCostPrice, setProductCostPrice] = useState("");
  const [productDeptId, setProductDeptId] = useState("");
  const [productBarcode, setProductBarcode] = useState("");

  useEffect(() => {
    fetchData();
  }, [orgId, superAdmin]);

  const fetchData = async () => {
    setLoading(true);
    const [deptRes, prodRes] = await Promise.all([
      filterByOrganizationId(supabase.from("departments").select("id, name, pos_catalog_mode").order("name"), orgId, superAdmin),
      filterByOrganizationId(
        supabase
          .from("products")
          .select("id, name, sales_price, cost_price, department_id, barcode, active")
          .order("name"),
        orgId,
        superAdmin
      ),
    ]);
    if (deptRes.data) setDepartments(deptRes.data as Department[]);
    const prods = (prodRes.data || []) as Product[];
    const deptMap = Object.fromEntries(
      (deptRes.data || []).map((d: Department) => [d.id, d.name])
    );
    setProducts(
      prods.map((p) => ({
        ...p,
        departments: p.department_id
          ? { name: deptMap[p.department_id] ?? "—" }
          : null,
      }))
    );
    setLoading(false);
  };

  const openDeptModal = (d?: Department) => {
    setEditingDept(d || null);
    setDeptName(d?.name ?? "");
    setDeptPosCatalog(d?.pos_catalog_mode === "dish_menu" ? "dish_menu" : "product_catalog");
    setShowDeptModal(true);
  };

  const saveDepartment = async () => {
    if (!deptName.trim()) {
      alert("Enter department name.");
      return;
    }
    if (editingDept) {
      const { error } = await supabase
        .from("departments")
        .update({ name: deptName.trim(), pos_catalog_mode: deptPosCatalog })
        .eq("id", editingDept.id);
      if (error) {
        alert(error.message);
        return;
      }
    } else {
      const payload: { name: string; pos_catalog_mode: PosCatalogMode; organization_id?: string } = {
        name: deptName.trim(),
        pos_catalog_mode: deptPosCatalog,
      };
      if (orgId) payload.organization_id = orgId;
      const { error } = await supabase
        .from("departments")
        .insert(payload);
      if (error) {
        alert(error.message);
        return;
      }
    }
    setShowDeptModal(false);
    fetchData();
  };

  const deleteDepartment = async (id: string) => {
    if (!confirm("Delete this department? Products may become unassigned."))
      return;
    const { error } = await supabase.from("departments").delete().eq("id", id);
    if (error) {
      alert(error.message);
      return;
    }
    fetchData();
  };

  const backfillDepartmentOrganizationIds = async () => {
    if (!orgId) {
      alert("Organization context is missing for this user.");
      return;
    }
    const { data: legacyRows, error: listError } = await supabase
      .from("departments")
      .select("id")
      .is("organization_id", null);
    if (listError) {
      alert(listError.message);
      return;
    }
    const ids = (legacyRows || []).map((r) => r.id as string).filter(Boolean);
    if (ids.length === 0) {
      alert("No legacy departments found.");
      return;
    }
    const { error: updateError } = await supabase
      .from("departments")
      .update({ organization_id: orgId })
      .in("id", ids);
    if (updateError) {
      alert(updateError.message);
      return;
    }
    alert(`Backfilled organization for ${ids.length} department(s).`);
    fetchData();
  };

  const openProductModal = (p?: Product) => {
    setEditingProduct(p || null);
    setProductName(p?.name ?? "");
    setProductSalesPrice(p ? String(p.sales_price) : "");
    setProductCostPrice(p && p.cost_price != null ? String(p.cost_price) : "");
    setProductDeptId(p?.department_id ?? departments[0]?.id ?? "");
    setProductBarcode(p?.barcode ?? "");
    setShowProductModal(true);
  };

  const saveProduct = async () => {
    if (!productName.trim() || !productSalesPrice || Number(productSalesPrice) < 0) {
      alert("Enter product name and valid sales price.");
      return;
    }
    const payload = {
      name: productName.trim(),
      sales_price: Number(productSalesPrice),
      cost_price: productCostPrice ? Number(productCostPrice) : 0,
      department_id: productDeptId || null,
      barcode: productBarcode.trim() || null,
      active: true,
    };
    if (editingProduct) {
      const { error } = await supabase
        .from("products")
        .update(payload)
        .eq("id", editingProduct.id);
      if (error) {
        alert(error.message);
        return;
      }
    } else {
      const { error } = await supabase.from("products").insert(payload);
      if (error) {
        alert(error.message);
        return;
      }
    }
    setShowProductModal(false);
    fetchData();
  };

  const toggleProductActive = async (p: Product) => {
    const next = !(p.active ?? true);
    const { error } = await supabase
      .from("products")
      .update({ active: next })
      .eq("id", p.id);
    if (error) {
      alert(error.message);
      return;
    }
    fetchData();
  };

  if (loading) {
    return <div className="text-slate-500 py-8">Loading…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-2 border-b border-slate-200">
        <button
          onClick={() => setActiveSection("departments")}
          className={`px-4 py-2 rounded-t-lg font-medium ${
            activeSection === "departments"
              ? "bg-brand-700 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          Departments
        </button>
        <button
          onClick={() => setActiveSection("products")}
          className={`px-4 py-2 rounded-t-lg font-medium ${
            activeSection === "products"
              ? "bg-brand-700 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          Products
        </button>
      </div>

      {activeSection === "departments" && (
        <>
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-slate-900">Departments</h2>
            <div className="flex items-center gap-2">
              {orgId ? (
                <button
                  onClick={() => void backfillDepartmentOrganizationIds()}
                  className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm"
                >
                  Fix legacy departments
                </button>
              ) : null}
              <button
                onClick={() => openDeptModal()}
                className="flex items-center gap-2 bg-brand-700 text-white px-4 py-2 rounded-lg hover:bg-brand-800"
              >
                <Plus className="w-4 h-4" />
                Add Department
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {departments.map((d) => (
              <div
                key={d.id}
                className="bg-white border border-slate-200 rounded-xl p-4 flex justify-between items-center"
              >
                <div className="flex items-center gap-3">
                  <div className="bg-slate-100 p-2 rounded-lg">
                    <Layers className="w-5 h-5 text-slate-600" />
                  </div>
                  <div>
                    <span className="font-medium text-slate-900">{d.name}</span>
                    <p className="text-xs text-slate-500 mt-0.5">
                      POS:{" "}
                      {d.pos_catalog_mode === "dish_menu"
                        ? "Kitchen menu (dishes)"
                        : "Bar / retail (products)"}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => openDeptModal(d)}
                    className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => deleteDepartment(d.id)}
                    className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {activeSection === "products" && (
        <>
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-slate-900">Products</h2>
            <button
              onClick={() => openProductModal()}
              disabled={departments.length === 0}
              className="flex items-center gap-2 bg-brand-700 text-white px-4 py-2 rounded-lg hover:bg-brand-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="w-4 h-4" />
              Add Product
            </button>
          </div>
          {departments.length === 0 && (
            <p className="text-amber-600 text-sm">
              Add at least one department before adding products.
            </p>
          )}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left py-3 px-4 font-medium">Product</th>
                  <th className="text-right py-3 px-4 font-medium">Sales Price</th>
                  <th className="text-right py-3 px-4 font-medium">Cost</th>
                  <th className="text-left py-3 px-4 font-medium">Barcode</th>
                  <th className="text-left py-3 px-4 font-medium">Department</th>
                  <th className="text-center py-3 px-4 font-medium">Active</th>
                  <th className="text-right py-3 px-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-3 px-4 font-medium">{p.name}</td>
                    <td className="py-3 px-4 text-right">
                      {Number(p.sales_price).toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {Number(p.cost_price ?? 0).toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-slate-600">{p.barcode || "—"}</td>
                    <td className="py-3 px-4 text-slate-600">
                      {p.department_id
                        ? departments.find((d) => d.id === p.department_id)?.name ?? "—"
                        : "—"}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          p.active !== false
                            ? "bg-green-100 text-green-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {p.active !== false ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => toggleProductActive(p)}
                        className="text-slate-600 hover:text-slate-800 mr-2"
                      >
                        {p.active !== false ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        onClick={() => openProductModal(p)}
                        className="text-slate-600 hover:text-slate-800"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showDeptModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">
              {editingDept ? "Edit Department" : "Add Department"}
            </h3>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Name
              </label>
              <input
                value={deptName}
                onChange={(e) => setDeptName(e.target.value)}
                className="border rounded-lg px-3 py-2 w-full"
                placeholder="e.g. Kitchen, Bar"
              />
            </div>
            <div className="mt-4">
              <label className="block text-sm font-medium text-slate-700 mb-1">POS list</label>
              <select
                value={deptPosCatalog}
                onChange={(e) => setDeptPosCatalog(e.target.value as PosCatalogMode)}
                className="border rounded-lg px-3 py-2 w-full text-sm"
              >
                <option value="dish_menu">Kitchen menu (dishes — attach recipes for ingredient stock)</option>
                <option value="product_catalog">Bar / sauna / retail (sell this product; stock on SKU)</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowDeptModal(false)}
                className="px-4 py-2 border rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={saveDepartment}
                className="px-4 py-2 bg-brand-700 text-white rounded-lg hover:bg-brand-800"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {showProductModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">
              {editingProduct ? "Edit Product" : "Add Product"}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Product Name
                </label>
                <input
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  className="border rounded-lg px-3 py-2 w-full"
                  placeholder="e.g. Coffee"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Sales Price
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={productSalesPrice}
                    onChange={(e) => setProductSalesPrice(e.target.value)}
                    className="border rounded-lg px-3 py-2 w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Cost Price
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={productCostPrice}
                    onChange={(e) => setProductCostPrice(e.target.value)}
                    className="border rounded-lg px-3 py-2 w-full"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Barcode
                </label>
                <input
                  value={productBarcode}
                  onChange={(e) => setProductBarcode(e.target.value)}
                  className="border rounded-lg px-3 py-2 w-full"
                  placeholder="Scan or type barcode"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Department
                </label>
                <select
                  value={productDeptId}
                  onChange={(e) => setProductDeptId(e.target.value)}
                  className="border rounded-lg px-3 py-2 w-full"
                >
                  <option value="">None</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowProductModal(false)}
                className="px-4 py-2 border rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={saveProduct}
                className="px-4 py-2 bg-brand-700 text-white rounded-lg hover:bg-brand-800"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
