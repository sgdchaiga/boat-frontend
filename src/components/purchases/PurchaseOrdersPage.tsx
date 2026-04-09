import { useEffect, useState } from "react";
import { Plus, X, CheckCircle, FileText, Trash2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { canApprove } from "../../lib/approvalRights";
import { ReadOnlyNotice } from "../common/ReadOnlyNotice";
import { PageNotes } from "../common/PageNotes";
import { createJournalForBill } from "../../lib/journal";
import { businessTodayISO } from "../../lib/timezone";

interface LineItem {
  id?: string;
  product_id: string; // product uuid, or "" for custom
  description: string;
  cost_price: number;
  quantity: number;
}

interface PurchaseOrderItem extends LineItem {
  id: string;
}

interface PurchaseOrder {
  id: string;
  vendor_id?: string | null;
  department_id?: string | null;
  order_date?: string | null;
  status?: string | null;
  total_amount?: number | null;
  approved_at?: string | null;
  created_at?: string;
  vendors?: { name: string } | null;
  departments?: { name: string } | null;
  purchase_order_items?: PurchaseOrderItem[];
}

interface PurchaseOrdersPageProps {
  onNavigate?: (page: string, state?: Record<string, unknown>) => void;
  readOnly?: boolean;
}

export function PurchaseOrdersPage({ onNavigate, readOnly = false }: PurchaseOrdersPageProps = {}) {
  const { user } = useAuth();
  const canApprovePO = canApprove("purchase_orders", user?.role);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [billsByPoId, setBillsByPoId] = useState<Record<string, string>>({}); // purchase_order_id -> bill id
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string; cost_price?: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingOrder, setEditingOrder] = useState<PurchaseOrder | null>(null);
  const [vendorId, setVendorId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { product_id: "", description: "", cost_price: 0, quantity: 1 },
  ]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [ordRes, venRes, deptRes, prodRes, billsRes] = await Promise.all([
        supabase
          .from("purchase_orders")
          .select("*, vendors(name), departments(name), purchase_order_items(*)")
          .order("order_date", { ascending: false }),
        supabase.from("vendors").select("id, name").order("name"),
        supabase.from("departments").select("id, name").order("name"),
        supabase.from("products").select("id, name, cost_price").order("name"),
        supabase.from("bills").select("id, purchase_order_id").not("purchase_order_id", "is", null),
      ]);
      if (ordRes.error) throw ordRes.error;
      setOrders(ordRes.data || []);
      setVendors(venRes.data || []);
      setDepartments(deptRes.data || []);
      setProducts((prodRes.data || []) as { id: string; name: string; cost_price?: number }[]);
      const byPo: Record<string, string> = {};
      (billsRes.data || []).forEach((b: { id: string; purchase_order_id?: string | null }) => {
        if (b.purchase_order_id) byPo[b.purchase_order_id] = b.id;
      });
      setBillsByPoId(byPo);
    } catch (e) {
      console.error("Error fetching purchase orders:", e);
      setOrders([]);
    } finally {
      setLoading(false);
    }
  };

  const lineTotal = (item: LineItem) => Number(item.cost_price || 0) * Number(item.quantity || 1);
  const grandTotal = lineItems.reduce((sum, i) => sum + lineTotal(i), 0);

  const addLineItem = () => {
    setLineItems([...lineItems, { product_id: "", description: "", cost_price: 0, quantity: 1 }]);
  };

  const removeLineItem = (idx: number) => {
    if (lineItems.length <= 1) return;
    setLineItems(lineItems.filter((_, i) => i !== idx));
  };

  const updateLineItem = (idx: number, field: keyof LineItem, value: string | number) => {
    const next = [...lineItems];
    (next[idx] as unknown as Record<string, string | number>)[field] = value;
    if (field === "product_id" && value && value !== "__custom__") {
      const prod = products.find((p) => p.id === value);
      if (prod) {
        next[idx].description = prod.name;
        if (prod.cost_price != null) next[idx].cost_price = Number(prod.cost_price);
      }
    }
    setLineItems(next);
  };

  const resetForm = () => {
    setEditingOrder(null);
    setVendorId("");
    setDepartmentId("");
    setOrderDate(new Date().toISOString().slice(0, 10));
    setLineItems([{ product_id: "", description: "", cost_price: 0, quantity: 1 }]);
  };

  const openCreate = () => {
    resetForm();
    setShowModal(true);
  };

  const openEdit = (order: PurchaseOrder) => {
    setEditingOrder(order);
    setVendorId(order.vendor_id || "");
    setDepartmentId(order.department_id || "");
    setOrderDate(order.order_date || new Date().toISOString().slice(0, 10));
    const items = (order.purchase_order_items || []).map((i) => ({
      product_id: (i as { product_id?: string }).product_id || "",
      description: i.description || "",
      cost_price: Number(i.cost_price || 0),
      quantity: Number(i.quantity || 1),
    }));
    setLineItems(items.length ? items : [{ product_id: "", description: "", cost_price: 0, quantity: 1 }]);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (readOnly) return;
    if (!vendorId) {
      alert("Select a vendor.");
      return;
    }
    const validItems = lineItems.filter((i) => (i.description || "").trim() || i.product_id);
    const withNames = validItems.map((i) => {
      const prod = products.find((p) => p.id === i.product_id);
      return {
        ...i,
        description: (i.description || "").trim() || (prod ? prod.name : "") || "Item",
      };
    });
    if (withNames.length === 0) {
      alert("Add at least one line item.");
      return;
    }
    const total = withNames.reduce((s, i) => s + lineTotal(i), 0);
    setSaving(true);
    try {
      if (editingOrder && editingOrder.status === "pending") {
        const { error: poErr } = await supabase
          .from("purchase_orders")
          .update({
            vendor_id: vendorId,
            department_id: departmentId || null,
            order_date: orderDate,
            total_amount: total,
          })
          .eq("id", editingOrder.id);
        if (poErr) throw poErr;
        await supabase
          .from("purchase_order_items")
          .delete()
          .eq("purchase_order_id", editingOrder.id);
        for (const i of withNames) {
          await supabase.from("purchase_order_items").insert({
            purchase_order_id: editingOrder.id,
            description: i.description,
            cost_price: i.cost_price,
            quantity: i.quantity,
          });
        }
      } else {
        const { data: poData, error: poErr } = await supabase
          .from("purchase_orders")
          .insert({
            vendor_id: vendorId,
            department_id: departmentId || null,
            order_date: orderDate,
            status: "pending",
            total_amount: total,
          })
          .select("id")
          .single();
        if (poErr || !poData) throw poErr || new Error("Failed to create PO");
        for (const i of withNames) {
          await supabase.from("purchase_order_items").insert({
            purchase_order_id: poData.id,
            description: i.description,
            cost_price: i.cost_price,
            quantity: i.quantity,
          });
        }
      }
      setShowModal(false);
      resetForm();
      fetchData();
    } catch (e) {
      console.error("Error saving purchase order:", e);
      alert("Failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async (order: PurchaseOrder) => {
    if (readOnly) return;
    if (order.status !== "pending") return;
    try {
      const { error } = await supabase
        .from("purchase_orders")
        .update({ status: "approved", approved_at: new Date().toISOString() })
        .eq("id", order.id);
      if (error) throw error;
      fetchData();
    } catch (e) {
      alert("Failed to approve: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleConvertToBill = async (order: PurchaseOrder) => {
    if (readOnly) return;
    if (order.status !== "approved" || billsByPoId[order.id]) return;
    try {
      const { data: newBill, error } = await supabase
        .from("bills")
        .insert({
          vendor_id: order.vendor_id,
          bill_date: businessTodayISO(),
          amount: Number(order.total_amount || 0),
          description: `From Purchase Order`,
          status: "pending_approval",
          purchase_order_id: order.id,
        })
        .select("id, bill_date")
        .single();
      if (error) throw error;
      if (newBill?.id) {
        const amt = Number(order.total_amount || 0);
        if (amt > 0) {
          const jr = await createJournalForBill(
            (newBill as { id: string }).id,
            amt,
            "From Purchase Order",
            (newBill as { bill_date?: string | null }).bill_date || businessTodayISO(),
            user?.id ?? null
          );
          if (!jr.ok) {
            alert(`GRN/Bill created but journal was not posted: ${jr.error}`);
          }
        }
      }
      setBillsByPoId((prev) => (newBill ? { ...prev, [order.id]: newBill.id } : prev));
      fetchData();
      if (newBill?.id && onNavigate) {
        onNavigate("purchases_bills", { highlightBillId: newBill.id });
      } else {
        alert("GRN/Bill created successfully.");
      }
    } catch (e) {
      alert("Failed to convert: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <div className="p-6 md:p-8">
      {readOnly && (
        <ReadOnlyNotice />
      )}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold text-slate-900">Purchase Orders</h1>
            <PageNotes ariaLabel="Purchase orders help">
              <p>Create and manage purchase orders.</p>
            </PageNotes>
          </div>
        </div>
        <button
          type="button"
          onClick={openCreate}
          disabled={readOnly}
          className="app-btn-primary disabled:cursor-not-allowed"
        >
          <Plus className="w-5 h-5" /> New Purchase Order
        </button>
      </div>

      {loading ? (
        <p className="text-slate-500 py-4">Loading…</p>
      ) : (
        <div className="app-card overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left p-3">Date</th>
                <th className="text-left p-3">Vendor</th>
                <th className="text-left p-3">Department</th>
                <th className="text-left p-3">Status</th>
                <th className="text-right p-3">Total</th>
                <th className="text-right p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-t hover:bg-slate-50">
                  <td className="p-3">{o.order_date ? new Date(o.order_date).toLocaleDateString() : "—"}</td>
                  <td className="p-3">{o.vendors?.name || "—"}</td>
                  <td className="p-3">{o.departments?.name || "—"}</td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${
                        o.status === "approved"
                          ? "bg-green-100 text-green-800"
                          : o.status === "pending"
                            ? "bg-amber-100 text-amber-800"
                            : o.status === "received"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {o.status || "pending"}
                    </span>
                  </td>
                  <td className="p-3 text-right font-medium">{Number(o.total_amount || 0).toFixed(2)}</td>
                  <td className="p-3 text-right space-x-2">
                    {o.status === "pending" && (
                      <>
                        <button
                          onClick={() => openEdit(o)}
                          disabled={readOnly}
                          className="text-slate-600 hover:text-slate-900"
                        >
                          Edit
                        </button>
                        {canApprovePO && (
                          <button
                            onClick={() => handleApprove(o)}
                            disabled={readOnly}
                            className="inline-flex items-center gap-1 text-green-600 hover:text-green-800"
                          >
                            <CheckCircle className="w-4 h-4" /> Approve
                          </button>
                        )}
                      </>
                    )}
                    {o.status === "approved" && (
                      <>
                        {billsByPoId[o.id] ? (
                          <button
                            type="button"
                            onClick={() => onNavigate?.("purchases_bills", { highlightBillId: billsByPoId[o.id] })}
                            className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-medium underline"
                          >
                            <FileText className="w-4 h-4" /> View GRN/Bill
                          </button>
                        ) : (
                          <button
                            onClick={() => handleConvertToBill(o)}
                            disabled={readOnly}
                            className="inline-flex items-center gap-1 text-slate-800 hover:text-slate-900 font-medium"
                          >
                            <FileText className="w-4 h-4" /> Convert to GRN/Bill
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {orders.length === 0 && (
            <p className="p-8 text-center text-slate-500">No purchase orders yet.</p>
          )}
        </div>
      )}

      {showModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto"
          onClick={() => !saving && setShowModal(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-2xl w-full my-8 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">
                {editingOrder ? "Edit Purchase Order" : "New Purchase Order"}
              </h2>
              <button type="button" onClick={() => !saving && setShowModal(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Vendor *</label>
                  <select
                    value={vendorId}
                    onChange={(e) => setVendorId(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2"
                  >
                    <option value="">Select vendor</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Department</label>
                  <select
                    value={departmentId}
                    onChange={(e) => setDepartmentId(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2"
                  >
                    <option value="">Select department</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Order Date</label>
                <input
                  type="date"
                  value={orderDate}
                  onChange={(e) => setOrderDate(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-medium">Line Items</label>
                  <button
                    type="button"
                    onClick={addLineItem}
                    className="text-sm text-slate-600 hover:text-slate-900"
                  >
                    + Add row
                  </button>
                </div>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="text-left p-2">Item</th>
                        <th className="text-right p-2 w-24">Cost</th>
                        <th className="text-right p-2 w-20">Qty</th>
                        <th className="text-right p-2 w-24">Amount</th>
                        <th className="w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lineItems.map((item, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="p-2">
                            <div className="flex flex-col gap-1">
                              <select
                                value={item.product_id ? (products.some((p) => p.id === item.product_id) ? item.product_id : "__custom__") : "__custom__"}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  updateLineItem(idx, "product_id", v === "__custom__" ? "__custom__" : v);
                                  if (v === "__custom__") updateLineItem(idx, "description", "");
                                }}
                                className="w-full border rounded px-2 py-1 text-sm"
                              >
                                <option value="">Select product...</option>
                                {products.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                  </option>
                                ))}
                                <option value="__custom__">— Other (not in catalog) —</option>
                              </select>
                              {(!item.product_id || item.product_id === "__custom__" || !products.some((p) => p.id === item.product_id)) && (
                                <input
                                  value={item.description}
                                  onChange={(e) =>
                                    updateLineItem(idx, "description", e.target.value)
                                  }
                                  className="w-full border rounded px-2 py-1 text-sm"
                                  placeholder="Enter custom item name"
                                />
                              )}
                            </div>
                          </td>
                          <td className="p-2 text-right">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={item.cost_price || ""}
                              onChange={(e) =>
                                updateLineItem(
                                  idx,
                                  "cost_price",
                                  parseFloat(e.target.value) || 0
                                )
                              }
                              className="w-full border rounded px-2 py-1 text-sm text-right"
                            />
                          </td>
                          <td className="p-2 text-right">
                            <input
                              type="number"
                              min="1"
                              value={item.quantity || ""}
                              onChange={(e) =>
                                updateLineItem(
                                  idx,
                                  "quantity",
                                  parseInt(e.target.value, 10) || 1
                                )
                              }
                              className="w-full border rounded px-2 py-1 text-sm text-right"
                            />
                          </td>
                          <td className="p-2 text-right font-medium">
                            {lineTotal(item).toFixed(2)}
                          </td>
                          <td className="p-2">
                            <button
                              type="button"
                              onClick={() => removeLineItem(idx)}
                              disabled={lineItems.length <= 1}
                              className="text-slate-400 hover:text-red-600 disabled:opacity-30"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2 text-right">
                  <span className="font-semibold">Total: {grandTotal.toFixed(2)}</span>
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                onClick={handleSave}
                disabled={saving}
                className="app-btn-primary flex-1 py-2"
              >
                {saving ? "Saving…" : editingOrder ? "Update" : "Create"}
              </button>
              <button
                type="button"
                onClick={() => !saving && setShowModal(false)}
                className="px-4 py-2 border rounded-lg hover:bg-slate-50"
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
