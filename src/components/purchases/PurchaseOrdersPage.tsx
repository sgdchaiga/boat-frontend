import { useEffect, useState, useMemo, useId } from "react";
import { Plus, X, CheckCircle, FileText, Trash2, Eye, Minus, Package } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { canApprove } from "../../lib/approvalRights";
import { ReadOnlyNotice } from "../common/ReadOnlyNotice";
import { PageNotes } from "../common/PageNotes";
import { createJournalForBill } from "../../lib/journal";
import { businessTodayISO } from "../../lib/timezone";
import { syncBillStatusInDb } from "../../lib/billStatus";
import { postStockInFromPurchaseOrderForBill } from "../../lib/poGrnStock";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import { desktopApi } from "../../lib/desktopApi";
import { loadHotelConfig } from "../../lib/hotelConfig";

const SIMPLE_MODE_KEY = "boat.record_purchases.simple_mode";

interface LineItem {
  id?: string;
  product_id: string;
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

function readSimpleModeDefault(): boolean {
  try {
    return localStorage.getItem(SIMPLE_MODE_KEY) !== "false";
  } catch {
    return true;
  }
}

function formatMoney(amount: number, currencyCode: string): string {
  const code = (currencyCode || "USD").trim() || "USD";
  try {
    const digits = code === "UGX" || code === "JPY" ? 0 : 2;
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    return `${code} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

export function PurchaseOrdersPage({ onNavigate, readOnly = false }: PurchaseOrdersPageProps = {}) {
  const { user } = useAuth();
  const canApprovePO = canApprove("purchase_orders", user?.role);
  const requirePoApproval = user?.purchases_require_po_approval !== false;
  const requireBillApproval = user?.purchases_require_bill_approval !== false;
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const isLocalDesktopMode =
    ((import.meta.env.VITE_LOCAL_AUTH || "").trim().toLowerCase() === "true" ||
      (import.meta.env.VITE_LOCAL_AUTH || "").trim().toLowerCase() === "1") &&
    (import.meta.env.VITE_DEPLOYMENT_MODE || "").trim().toLowerCase() === "lan";

  const currency = useMemo(() => loadHotelConfig(user?.organization_id ?? null).currency || "UGX", [user?.organization_id]);
  const datalistId = useId();

  const [simpleMode, setSimpleMode] = useState(readSimpleModeDefault);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [billsByPoId, setBillsByPoId] = useState<Record<string, string>>({});
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string; cost_price?: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [viewOrder, setViewOrder] = useState<PurchaseOrder | null>(null);
  const [editingOrder, setEditingOrder] = useState<PurchaseOrder | null>(null);
  const [vendorId, setVendorId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { product_id: "", description: "", cost_price: 0, quantity: 1 },
  ]);
  const [saving, setSaving] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const setSimpleModePersist = (next: boolean) => {
    setSimpleMode(next);
    try {
      localStorage.setItem(SIMPLE_MODE_KEY, next ? "true" : "false");
    } catch {
      /* ignore */
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      if (isLocalDesktopMode && desktopApi.isAvailable()) {
        const [ordersRes, vendorsRes, departmentsRes, productsRes, posProductsRes] = await Promise.all([
          desktopApi.localSelect({
            table: "purchase_orders",
            orderBy: { column: "order_date", ascending: false },
            limit: 500,
          }),
          desktopApi.localSelect({
            table: "vendors",
            orderBy: { column: "name", ascending: true },
            limit: 1000,
          }),
          desktopApi.localSelect({
            table: "departments",
            orderBy: { column: "name", ascending: true },
            limit: 1000,
          }),
          desktopApi.localSelect({
            table: "products",
            orderBy: { column: "name", ascending: true },
            limit: 2000,
          }),
          desktopApi.listPosProducts(),
        ]);

        const localOrders = ((ordersRes.rows || []) as Array<Record<string, unknown>>).map((row) => ({
          id: String(row.id || ""),
          vendor_id: (row.vendor_id as string | null) ?? null,
          department_id: (row.department_id as string | null) ?? null,
          order_date: (row.order_date as string | null) ?? null,
          status: (row.status as string | null) ?? "pending",
          total_amount: Number(row.total_amount ?? 0),
          approved_at: (row.approved_at as string | null) ?? null,
          created_at: (row.created_at as string | undefined) || undefined,
        })) as PurchaseOrder[];

        const localVendors = ((vendorsRes.rows || []) as Array<Record<string, unknown>>)
          .map((row) => ({
            id: String(row.id || ""),
            name: String(row.name || ""),
          }))
          .filter((row) => row.id && row.name);

        const localDepartments = ((departmentsRes.rows || []) as Array<Record<string, unknown>>)
          .map((row) => ({
            id: String(row.id || ""),
            name: String(row.name || ""),
          }))
          .filter((row) => row.id && row.name);

        const productMap = new Map<string, { id: string; name: string; cost_price?: number }>();
        ((productsRes.rows || []) as Array<Record<string, unknown>>).forEach((row) => {
          const id = String(row.id || "");
          const name = String(row.name || "");
          if (!id || !name) return;
          productMap.set(id, {
            id,
            name,
            cost_price: row.cost_price == null ? undefined : Number(row.cost_price),
          });
        });
        (posProductsRes || []).forEach((row) => {
          const id = String(row.id || "");
          const name = String(row.name || "");
          if (!id || !name || productMap.has(id)) return;
          productMap.set(id, {
            id,
            name,
            cost_price: undefined,
          });
        });

        const sortedOrders = localOrders.sort(
          (a, b) =>
            new Date(b.order_date || b.created_at || 0).getTime() - new Date(a.order_date || a.created_at || 0).getTime()
        );
        const sortedVendors = localVendors.sort((a, b) => a.name.localeCompare(b.name));
        const sortedDepartments = localDepartments.sort((a, b) => a.name.localeCompare(b.name));
        const sortedProducts = Array.from(productMap.values()).sort((a, b) => a.name.localeCompare(b.name));

        setOrders(sortedOrders);
        setVendors(sortedVendors);
        setDepartments(sortedDepartments);
        setProducts(sortedProducts);
        setBillsByPoId({});
        return;
      }

      const loadReferenceRows = async (table: "vendors" | "departments" | "products", columns: string) => {
        if (!orgId || superAdmin || !isLocalDesktopMode) {
          return filterByOrganizationId(supabase.from(table).select(columns), orgId, superAdmin);
        }
        const [owned, legacy] = await Promise.all([
          supabase.from(table).select(columns).eq("organization_id", orgId),
          supabase.from(table).select(columns).is("organization_id", null),
        ]);
        if (owned.error) return owned;
        if (legacy.error) return legacy;
        const merged = [...(owned.data || []), ...(legacy.data || [])];
        const deduped = Array.from(new Map(merged.map((row: { id: string }) => [row.id, row])).values());
        return { data: deduped, error: null };
      };

      const [ordRes, venRes, deptRes, prodRes, billsRes] = await Promise.all([
        filterByOrganizationId(
          supabase.from("purchase_orders").select("*, vendors(name), departments(name), purchase_order_items(*)"),
          orgId,
          superAdmin
        ),
        loadReferenceRows("vendors", "id, name, organization_id"),
        loadReferenceRows("departments", "id, name, organization_id"),
        loadReferenceRows("products", "id, name, cost_price, organization_id"),
        filterByOrganizationId(
          supabase.from("bills").select("id, purchase_order_id").not("purchase_order_id", "is", null),
          orgId,
          superAdmin
        ),
      ]);
      if (ordRes.error) throw ordRes.error;
      if (venRes.error) console.warn("Vendors load warning:", venRes.error.message);
      if (deptRes.error) console.warn("Departments load warning:", deptRes.error.message);
      if (prodRes.error) console.warn("Products load warning:", prodRes.error.message);
      if (billsRes.error) console.warn("Bills load warning:", billsRes.error.message);

      const sortedOrders = ((ordRes.data || []) as PurchaseOrder[]).sort(
        (a, b) =>
          new Date(b.order_date || b.created_at || 0).getTime() - new Date(a.order_date || a.created_at || 0).getTime()
      );
      const sortedVendors = ((venRes.data || []) as Array<{ id: string; name: string }>).sort((a, b) =>
        (a.name || "").localeCompare(b.name || "")
      );
      const sortedDepartments = ((deptRes.data || []) as Array<{ id: string; name: string }>).sort((a, b) =>
        (a.name || "").localeCompare(b.name || "")
      );
      const sortedProducts = ((prodRes.data || []) as { id: string; name: string; cost_price?: number }[]).sort((a, b) =>
        (a.name || "").localeCompare(b.name || "")
      );

      setOrders(sortedOrders);
      setVendors(sortedVendors);
      setDepartments(sortedDepartments);
      setProducts(sortedProducts);
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

  const findProductByName = (name: string) => {
    const t = name.trim().toLowerCase();
    if (!t) return null;
    return products.find((p) => p.name.trim().toLowerCase() === t) ?? null;
  };

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

  const onItemNameInput = (idx: number, raw: string) => {
    const next = [...lineItems];
    next[idx].description = raw;
    const matched = findProductByName(raw);
    if (matched) {
      next[idx].product_id = matched.id;
      if (matched.cost_price != null) next[idx].cost_price = Number(matched.cost_price);
    } else {
      next[idx].product_id = "";
    }
    setLineItems(next);
  };

  const bumpQty = (idx: number, delta: number) => {
    const next = [...lineItems];
    const q = Math.max(1, Number(next[idx].quantity || 1) + delta);
    next[idx].quantity = q;
    setLineItems(next);
  };

  const resetForm = () => {
    setEditingOrder(null);
    setVendorId("");
    setDepartmentId("");
    setOrderDate(new Date().toISOString().slice(0, 10));
    setLineItems([{ product_id: "", description: "", cost_price: 0, quantity: 1 }]);
    setAdvancedOpen(false);
  };

  const openCreate = () => {
    resetForm();
    setShowModal(true);
  };

  const loadDesktopLineItems = async (purchaseOrderId: string): Promise<PurchaseOrderItem[]> => {
    if (!isLocalDesktopMode || !desktopApi.isAvailable()) return [];
    const res = await desktopApi.localSelect({
      table: "purchase_order_items",
      filters: [{ column: "purchase_order_id", operator: "eq", value: purchaseOrderId }],
      orderBy: { column: "id", ascending: true },
      limit: 500,
    });
    return ((res.rows || []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id || ""),
      description: String(row.description || ""),
      cost_price: Number(row.cost_price ?? 0),
      quantity: Number(row.quantity ?? 1),
      product_id: "",
    })) as PurchaseOrderItem[];
  };

  const openEdit = async (order: PurchaseOrder) => {
    let o = order;
    if (isLocalDesktopMode && (!order.purchase_order_items || order.purchase_order_items.length === 0)) {
      const rows = await loadDesktopLineItems(order.id);
      o = { ...order, purchase_order_items: rows };
    }
    setEditingOrder(o);
    setVendorId(o.vendor_id || "");
    setDepartmentId(o.department_id || "");
    setOrderDate(o.order_date || new Date().toISOString().slice(0, 10));
    const items = (o.purchase_order_items || []).map((i) => ({
      product_id: (i as { product_id?: string }).product_id || "",
      description: i.description || "",
      cost_price: Number(i.cost_price || 0),
      quantity: Number(i.quantity || 1),
    }));
    setLineItems(items.length ? items : [{ product_id: "", description: "", cost_price: 0, quantity: 1 }]);
    setAdvancedOpen(!simpleMode);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (readOnly) return;
    if (!vendorId) {
      alert(simpleMode ? "Choose who you bought from." : "Select a vendor.");
      return;
    }
    const validItems = lineItems.filter((i) => (i.description || "").trim() || i.product_id);
    const withNames = validItems.map((i) => {
      const prod = products.find((p) => p.id === i.product_id);
      const byName = findProductByName(i.description || "");
      return {
        ...i,
        description: (i.description || "").trim() || (prod ? prod.name : "") || (byName ? byName.name : "") || "Item",
      };
    });
    if (withNames.length === 0) {
      alert(simpleMode ? "Add at least one item you bought." : "Add at least one line item.");
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
        await supabase.from("purchase_order_items").delete().eq("purchase_order_id", editingOrder.id);
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
        if (poErr || !poData) throw poErr || new Error("Failed to create purchase");
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

  const canConvertToBill = (order: PurchaseOrder) => {
    if (billsByPoId[order.id]) return false;
    if (requirePoApproval) return order.status === "approved";
    return order.status === "pending" || order.status === "approved";
  };

  const handleConvertToBill = async (order: PurchaseOrder) => {
    if (readOnly) return;
    if (!canConvertToBill(order)) return;
    try {
      const approvedAt = new Date().toISOString();
      const { data: staffRow } = await supabase.from("staff").select("id").eq("id", user?.id ?? "").maybeSingle();
      const approvedBy = staffRow?.id ? String(staffRow.id) : null;
      const autoFinalizeBill = !requireBillApproval;
      const amt = Number(order.total_amount || 0);

      const insertPayload: Record<string, unknown> = {
        vendor_id: order.vendor_id,
        bill_date: businessTodayISO(),
        amount: amt,
        description: `From Purchase Order`,
        purchase_order_id: order.id,
        status: autoFinalizeBill ? "approved" : "pending_approval",
      };
      if (orgId) insertPayload.organization_id = orgId;
      if (autoFinalizeBill) {
        insertPayload.approved_at = approvedAt;
        if (approvedBy) insertPayload.approved_by = approvedBy;
      }

      let newBill: { id: string; bill_date?: string | null } | null = null;
      let ins = await supabase.from("bills").insert(insertPayload).select("id, bill_date").single();
      if (ins.error) {
        const msg = String(ins.error.message || "").toLowerCase();
        if (msg.includes("approved_at") || msg.includes("approved_by")) {
          const fallbackPayload = { ...insertPayload };
          delete fallbackPayload.approved_at;
          delete fallbackPayload.approved_by;
          ins = await supabase.from("bills").insert(fallbackPayload).select("id, bill_date").single();
        }
      }
      if (ins.error) throw ins.error;
      newBill = ins.data as { id: string; bill_date?: string | null };

      if (order.status === "pending") {
        const { error: poUpdErr } = await supabase
          .from("purchase_orders")
          .update({ status: "approved", approved_at: approvedAt })
          .eq("id", order.id);
        if (poUpdErr) console.warn("PO status update after convert:", poUpdErr.message);
      }

      if (newBill?.id && amt > 0) {
        const jr = await createJournalForBill(
          newBill.id,
          amt,
          "From Purchase Order",
          newBill.bill_date || businessTodayISO(),
          user?.id ?? null
        );
        if (!jr.ok) {
          alert(`GRN/Bill created but journal was not posted: ${jr.error}`);
        }
      }

      if (newBill?.id && autoFinalizeBill) {
        await syncBillStatusInDb(newBill.id);
        const { unmatchedDescriptions } = await postStockInFromPurchaseOrderForBill(newBill.id, order.id);
        if (unmatchedDescriptions.length > 0) {
          const list = unmatchedDescriptions.join("\n- ");
          alert(
            `Stock receipt recorded, but some lines were not matched to products:\n- ${list}\n\n` +
              `Tip: Match names to your product list, or adjust stock manually.`
          );
        }
      }

      if (newBill?.id) {
        setBillsByPoId((prev) => ({ ...prev, [order.id]: newBill.id }));
      }
      fetchData();
      if (newBill?.id && onNavigate) {
        onNavigate("purchases_bills", { highlightBillId: newBill.id });
      } else {
        alert(simpleMode ? "Purchase received into stock." : "GRN/Bill created successfully.");
      }
    } catch (e) {
      alert("Failed: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const friendlySubtitle = (o: PurchaseOrder) => {
    if (billsByPoId[o.id]) return "Received in stock";
    if (requirePoApproval && o.status === "pending") return "Waiting for approval";
    return "Ready to receive";
  };

  const openView = async (o: PurchaseOrder) => {
    if (isLocalDesktopMode && desktopApi.isAvailable() && (!o.purchase_order_items || o.purchase_order_items.length === 0)) {
      try {
        const rows = await loadDesktopLineItems(o.id);
        setViewOrder({ ...o, purchase_order_items: rows });
        return;
      } catch (e) {
        console.warn("Could not load line items for view:", e);
      }
    }
    setViewOrder(o);
  };

  return (
    <div className="p-6 md:p-8">
      {readOnly && <ReadOnlyNotice />}

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold text-slate-900">Buy stock</h1>
            <PageNotes ariaLabel="Record purchases help">
              <p>
                Who you bought from, what you bought, how many, and how much. Use <strong>Receive stock</strong> when goods
                arrive (creates the GRN/bill in the system).
              </p>
            </PageNotes>
          </div>
        </div>
        <div className="flex flex-col sm:items-end gap-2">
          <div
            className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-medium"
            role="group"
            aria-label="Simple or advanced mode"
          >
            <button
              type="button"
              onClick={() => setSimpleModePersist(true)}
              className={`px-3 py-1.5 rounded-md transition ${
                simpleMode ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Simple
            </button>
            <button
              type="button"
              onClick={() => setSimpleModePersist(false)}
              className={`px-3 py-1.5 rounded-md transition ${
                !simpleMode ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Advanced
            </button>
          </div>
          <button
            type="button"
            onClick={openCreate}
            disabled={readOnly}
            className="app-btn-primary inline-flex items-center justify-center gap-2 px-5 py-2.5 text-base font-semibold disabled:cursor-not-allowed"
          >
            <Plus className="w-5 h-5" /> Record purchase
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-slate-500 py-4">Loading…</p>
      ) : (
        <div className="space-y-3">
          {orders.length === 0 && <p className="text-center text-slate-500 py-12 bg-white rounded-xl border border-slate-200">No purchases recorded yet.</p>}
          {orders.map((o) => (
            <div
              key={o.id}
              className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-500">
                  {o.order_date ? new Date(o.order_date).toLocaleDateString() : "—"}
                  {!simpleMode && o.departments?.name && (
                    <span className="text-slate-400"> · {o.departments.name}</span>
                  )}
                </p>
                <p className="text-lg font-semibold text-slate-900 truncate">{o.vendors?.name || "—"}</p>
                <p className="text-sm text-slate-600 mt-0.5">{friendlySubtitle(o)}</p>
                <div className="mt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total cost</p>
                  <p className="text-2xl font-bold text-slate-900 tabular-nums">
                    {formatMoney(Number(o.total_amount || 0), currency)}
                  </p>
                </div>
                {!simpleMode && (
                  <p className="text-xs text-slate-500 mt-1">
                    Status:{" "}
                    <span className="font-medium text-slate-700">{o.status || "pending"}</span>
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2 sm:items-end shrink-0 w-full sm:w-auto">
                <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => void openView(o)}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border-2 border-slate-200 bg-white text-slate-800 font-semibold text-sm hover:bg-slate-50"
                  >
                    <Eye className="w-4 h-4" /> View
                  </button>
                  {o.status === "pending" && (
                    <button
                      type="button"
                      onClick={() => void openEdit(o)}
                      disabled={readOnly}
                      className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border-2 border-brand-600 text-brand-700 bg-white font-semibold text-sm hover:bg-brand-50 disabled:opacity-50"
                    >
                      Edit
                    </button>
                  )}
                  {requirePoApproval && canApprovePO && o.status === "pending" && (
                    <button
                      type="button"
                      onClick={() => handleApprove(o)}
                      disabled={readOnly}
                      className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <CheckCircle className="w-4 h-4" /> Approve
                    </button>
                  )}
                  {canConvertToBill(o) && (
                    <>
                      {billsByPoId[o.id] ? (
                        <button
                          type="button"
                          onClick={() => onNavigate?.("purchases_bills", { highlightBillId: billsByPoId[o.id] })}
                          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-800 text-white font-semibold text-sm hover:bg-slate-900 col-span-2 sm:col-span-1"
                        >
                          <FileText className="w-4 h-4" /> View GRN/Bill
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleConvertToBill(o)}
                          disabled={readOnly}
                          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-800 text-white font-semibold text-sm hover:bg-slate-900 col-span-2 sm:col-span-1"
                        >
                          <Package className="w-4 h-4" /> Receive stock
                        </button>
                      )}
                    </>
                  )}
                </div>
                {simpleMode && requirePoApproval && o.status === "pending" && !canApprovePO && (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5 text-center sm:text-right">
                    Waiting for a manager to approve before you can receive stock.
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* View-only summary */}
      {viewOrder && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setViewOrder(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-xl font-bold">Purchase details</h2>
              <button type="button" onClick={() => setViewOrder(null)} aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2 text-sm">
              <p>
                <span className="text-slate-500">Supplier</span>
                <br />
                <span className="font-medium text-slate-900">{viewOrder.vendors?.name || "—"}</span>
              </p>
              <p>
                <span className="text-slate-500">Date</span>
                <br />
                {viewOrder.order_date ? new Date(viewOrder.order_date).toLocaleDateString() : "—"}
              </p>
              <div className="border rounded-lg divide-y mt-3">
                {(viewOrder.purchase_order_items || []).length > 0 ? (
                  (viewOrder.purchase_order_items || []).map((row, i) => (
                    <div key={row.id || i} className="p-3 flex justify-between gap-2">
                      <span>{row.description || "—"}</span>
                      <span className="text-slate-600 tabular-nums">
                        ×{Number(row.quantity || 1)} @ {formatMoney(Number(row.cost_price || 0), currency)} ={" "}
                        {formatMoney(Number(row.quantity || 1) * Number(row.cost_price || 0), currency)}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="p-3 text-slate-500">Line items not loaded.</p>
                )}
              </div>
              <p className="pt-3 text-center">
                <span className="text-xs font-semibold uppercase text-slate-500">Total cost</span>
                <br />
                <span className="text-2xl font-bold text-slate-900">
                  {formatMoney(Number(viewOrder.total_amount || 0), currency)}
                </span>
              </p>
            </div>
            <button
              type="button"
              className="mt-6 w-full app-btn-primary py-2.5"
              onClick={() => {
                if (viewOrder.status === "pending" && !readOnly) {
                  void openEdit(viewOrder);
                  setViewOrder(null);
                } else {
                  setViewOrder(null);
                }
              }}
            >
              {viewOrder.status === "pending" && !readOnly ? "Edit purchase" : "Close"}
            </button>
          </div>
        </div>
      )}

      {showModal && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => !saving && setShowModal(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[min(90vh,calc(100dvh-1rem))] my-4 sm:my-8 p-6 flex flex-col min-h-0"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="purchase-modal-title"
          >
            <div className="flex justify-between items-center shrink-0 mb-4">
              <h2 id="purchase-modal-title" className="text-xl font-bold text-slate-900">
                {editingOrder ? "Edit purchase" : "New purchase"}
              </h2>
              <button type="button" onClick={() => !saving && setShowModal(false)} aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-6 flex-1 min-h-0 overflow-y-auto">
              <section>
                <label className="block text-sm font-medium text-slate-700 mb-1">Supplier</label>
                <select
                  value={vendorId}
                  onChange={(e) => setVendorId(e.target.value)}
                  className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-base"
                >
                  <option value="">Select supplier</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </section>

              {!simpleMode && (
                <section>
                  <button
                    type="button"
                    onClick={() => setAdvancedOpen((v) => !v)}
                    className="text-sm font-medium text-slate-600 hover:text-slate-900 underline"
                  >
                    {advancedOpen ? "Hide" : "Show"} advanced (department, date)
                  </button>
                  {advancedOpen && (
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium mb-1">Department</label>
                        <select
                          value={departmentId}
                          onChange={(e) => setDepartmentId(e.target.value)}
                          className="w-full border rounded-lg px-3 py-2"
                        >
                          <option value="">—</option>
                          {departments.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1">Purchase date</label>
                        <input
                          type="date"
                          value={orderDate}
                          onChange={(e) => setOrderDate(e.target.value)}
                          className="w-full border rounded-lg px-3 py-2"
                        />
                      </div>
                    </div>
                  )}
                </section>
              )}

              <section className="flex flex-col min-h-0">
                <span className="text-sm font-medium text-slate-700 mb-2">Items</span>
                <datalist id={datalistId}>
                  {products.map((p) => (
                    <option key={p.id} value={p.name} />
                  ))}
                </datalist>
                <div className="space-y-3 max-h-[min(50vh,24rem)] overflow-y-auto overscroll-contain pr-1">
                  {lineItems.map((item, idx) => (
                    <div key={idx} className="border-2 border-slate-100 rounded-xl p-4 bg-slate-50/80 space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Item name</label>
                        <input
                          list={datalistId}
                          value={item.description}
                          onChange={(e) => onItemNameInput(idx, e.target.value)}
                          placeholder="What did you buy?"
                          className="w-full border rounded-lg px-3 py-2 text-base"
                        />
                        <p className="text-xs text-slate-500 mt-1">Matches your product list when the name is the same.</p>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">Quantity</label>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              className="shrink-0 w-10 h-10 rounded-lg border border-slate-200 bg-white flex items-center justify-center hover:bg-slate-100"
                              onClick={() => bumpQty(idx, -1)}
                              aria-label="Decrease quantity"
                            >
                              <Minus className="w-4 h-4" />
                            </button>
                            <input
                              type="number"
                              min={1}
                              value={item.quantity}
                              onChange={(e) => updateLineItem(idx, "quantity", parseInt(e.target.value, 10) || 1)}
                              className="flex-1 min-w-0 border rounded-lg px-2 py-2 text-center text-base font-medium"
                            />
                            <button
                              type="button"
                              className="shrink-0 w-10 h-10 rounded-lg border border-slate-200 bg-white flex items-center justify-center hover:bg-slate-100"
                              onClick={() => bumpQty(idx, 1)}
                              aria-label="Increase quantity"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">Price (each)</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={item.cost_price || ""}
                            onChange={(e) => updateLineItem(idx, "cost_price", parseFloat(e.target.value) || 0)}
                            className="w-full border rounded-lg px-3 py-2 text-base text-right"
                          />
                        </div>
                      </div>
                      <div className="flex justify-between items-center pt-1 border-t border-slate-200">
                        <span className="text-sm text-slate-600">Subtotal</span>
                        <span className="text-lg font-semibold text-slate-900 tabular-nums">
                          {formatMoney(lineTotal(item), currency)}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeLineItem(idx)}
                          disabled={lineItems.length <= 1}
                          className="text-slate-400 hover:text-red-600 disabled:opacity-30 p-1"
                          aria-label="Remove item"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={addLineItem}
                      className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 bg-brand-50 border border-brand-200 rounded-lg px-3 py-2 hover:bg-brand-100"
                    >
                      <Plus className="w-4 h-4 shrink-0" />
                      Add item
                    </button>
                  </div>
                </div>
              </section>

              <section className="rounded-xl bg-slate-900 text-white p-5 text-center">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">Total cost</p>
                <p className="text-3xl font-bold tabular-nums">{formatMoney(grandTotal, currency)}</p>
              </section>
            </div>

            <div className="flex flex-col gap-2 mt-4 pt-4 border-t border-slate-200 shrink-0">
              <button
                onClick={handleSave}
                disabled={saving}
                className="app-btn-primary w-full py-3 text-base font-semibold"
              >
                {saving ? "Saving…" : editingOrder ? "Save changes" : "Save purchase"}
              </button>
              <button
                type="button"
                onClick={() => !saving && setShowModal(false)}
                className="w-full py-2.5 border rounded-lg font-medium text-slate-700 hover:bg-slate-50"
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
