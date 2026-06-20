import { useEffect, useMemo, useState } from "react";
import { PageNotes } from "../common/PageNotes";
import { ReadOnlyNotice } from "../common/ReadOnlyNotice";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import { createJournalForManufacturingCostingEntry } from "../../lib/journal";
import { Pencil, Plus, Settings2, Trash2, X } from "lucide-react";

type WorkOrderRow = { id: string; product_name: string };
type StaffRow = { id: string; full_name: string };
type ProductRow = { id: string; name: string; manufacturing_item_type?: string | null };
type BomRow = { id: string; product_id: string; version: string; status: string; output_qty: number; materials: unknown[] };
type PendingProductionItem = {
  key: string;
  manualSerial: string;
  productId: string;
  workOrderId: string;
  producedQty: string;
  scrapQty: string;
};
type ColumnKey = "serial" | "date" | "product" | "order" | "employee" | "produced" | "scrap" | "materialCost" | "bom" | "actions";

const COLUMN_OPTIONS: Array<{ key: ColumnKey; label: string }> = [
  { key: "serial", label: "Serial number" },
  { key: "date", label: "Date" },
  { key: "product", label: "Product" },
  { key: "order", label: "Production order" },
  { key: "employee", label: "Employee" },
  { key: "produced", label: "Produced quantity" },
  { key: "scrap", label: "Scrap quantity" },
  { key: "materialCost", label: "Material cost" },
  { key: "bom", label: "BOM" },
  { key: "actions", label: "Actions" },
];

function nextProductionSerial(previous: unknown): string {
  const value = String(previous ?? "").trim();
  if (!value) return "1";
  const match = /^(.*?)(\d+)$/.exec(value);
  if (!match) return `${value}-1`;
  const [, prefix, digits] = match;
  return `${prefix}${String(Number(digits) + 1).padStart(digits.length, "0")}`;
}

async function productionCostAllocation(entryId: string): Promise<{ consumablesCost: number; scrapCost: number }> {
  const { data: movements } = await supabase
    .from("product_stock_movements")
    .select("product_id,source_type,quantity_in,quantity_out,unit_cost")
    .eq("source_id", entryId)
    .in("source_type", ["manufacturing_consumption", "manufacturing_scrap"]);
  const rows = (movements || []) as Array<Record<string, unknown>>;
  const consumedProductIds = [...new Set(
    rows
      .filter((row) => row.source_type === "manufacturing_consumption")
      .map((row) => String(row.product_id || ""))
      .filter(Boolean)
  )];
  const { data: consumedProducts } = consumedProductIds.length
    ? await supabase.from("products").select("id,manufacturing_item_type").in("id", consumedProductIds)
    : { data: [] };
  const consumableIds = new Set(
    ((consumedProducts || []) as Array<{ id: string; manufacturing_item_type?: string | null }>)
      .filter((product) => product.manufacturing_item_type === "consumable")
      .map((product) => product.id)
  );
  const amount = (quantity: unknown, unitCost: unknown) => Number(quantity || 0) * Number(unitCost || 0);
  return {
    consumablesCost: rows
      .filter((row) => row.source_type === "manufacturing_consumption" && consumableIds.has(String(row.product_id)))
      .reduce((sum, row) => sum + amount(row.quantity_out, row.unit_cost), 0),
    scrapCost: rows
      .filter((row) => row.source_type === "manufacturing_scrap")
      .reduce((sum, row) => sum + amount(row.quantity_in, row.unit_cost), 0),
  };
}

export function ManufacturingProductionEntriesPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!user?.isSuperAdmin;
  const [rowsData, setRowsData] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [workOrders, setWorkOrders] = useState<WorkOrderRow[]>([]);
  const [staffList, setStaffList] = useState<StaffRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [boms, setBoms] = useState<BomRow[]>([]);
  const [workOrderId, setWorkOrderId] = useState("");
  const [productId, setProductId] = useState("");
  const [postedByStaffId, setPostedByStaffId] = useState("");
  const [manualSerial, setManualSerial] = useState("");
  const [productionDate, setProductionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [producedQty, setProducedQty] = useState("0");
  const [scrapQty, setScrapQty] = useState("0");
  const [pendingItems, setPendingItems] = useState<PendingProductionItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showColumns, setShowColumns] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>([
    "serial", "date", "product", "order", "produced", "scrap", "actions",
  ]);

  const loadEntries = async () => {
    setLoading(true);
    const query = filterByOrganizationId(supabase.from("manufacturing_production_entries").select("*"), orgId, superAdmin);
    const { data, error: fetchError } = await query.order("posted_at", { ascending: false });
    if (fetchError) setError(fetchError.message);
    const rows = (data || []) as Array<Record<string, unknown>>;
    setRowsData(rows);
    setManualSerial((current) => current.trim() || nextProductionSerial(rows[0]?.manual_serial_number));
    setLoading(false);
  };

  const loadRefs = async () => {
    if (!orgId && !superAdmin) return;
    const [woRes, staffRes, productRes, bomRes] = await Promise.all([
      filterByOrganizationId(supabase.from("manufacturing_work_orders").select("id,product_name").order("created_at", { ascending: false }), orgId, superAdmin),
      filterByOrganizationId(supabase.from("staff").select("id,full_name").order("full_name"), orgId, superAdmin),
      filterByOrganizationId(supabase.from("products").select("id,name,manufacturing_item_type").eq("active", true).order("name"), orgId, superAdmin),
      filterByOrganizationId(supabase.from("manufacturing_boms").select("id,product_id,version,status,output_qty,materials").in("status", ["Active", "Draft"]).order("updated_at", { ascending: false }), orgId, superAdmin),
    ]);
    setWorkOrders((woRes.data || []) as WorkOrderRow[]);
    setStaffList((staffRes.data || []) as StaffRow[]);
    const allProducts = (productRes.data || []) as ProductRow[];
    const finished = allProducts.filter((product) => product.manufacturing_item_type === "finished_product");
    setProducts(finished.length ? finished : allProducts);
    setBoms((bomRes.data || []) as BomRow[]);
  };

  useEffect(() => { void loadEntries(); void loadRefs(); }, [orgId, superAdmin]);
  useEffect(() => { if (user?.id && !postedByStaffId) setPostedByStaffId(user.id); }, [user?.id, postedByStaffId]);

  const resetForm = (nextSerial?: string) => {
    setEditingId(null);
    setPendingItems([]);
    setWorkOrderId("");
    setProductId("");
    setManualSerial(nextSerial ?? nextProductionSerial(rowsData[0]?.manual_serial_number));
    setProductionDate(new Date().toISOString().slice(0, 10));
    setProducedQty("0");
    setScrapQty("0");
    setPostedByStaffId(user?.id ?? "");
  };

  const startEdit = (row: Record<string, unknown>) => {
    setEditingId(String(row.id));
    setPendingItems([]);
    setWorkOrderId(String(row.work_order_id || ""));
    setProductId(String(row.product_id || ""));
    setManualSerial(String(row.manual_serial_number || ""));
    setProductionDate(String(row.production_date || String(row.posted_at || "").slice(0, 10)));
    setProducedQty(String(row.produced_qty || 0));
    setScrapQty(String(row.scrap_qty || 0));
    setPostedByStaffId(String(row.posted_by_staff_id || user?.id || ""));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const validateProductionItem = (item: PendingProductionItem): string | null => {
    if (!item.manualSerial.trim()) return "Enter a manual serial number.";
    if (!item.productId) return "Select a finished product.";
    const itemBom = boms.find((bom) => bom.product_id === item.productId && bom.status === "Active")
      || boms.find((bom) => bom.product_id === item.productId);
    if (!itemBom) return "Create an Active or Draft BOM for each finished product before recording production.";
    if (Number(item.producedQty) <= 0) return "Produced quantity must be greater than zero for every item.";
    if (Number(item.scrapQty || 0) < 0) return "Scrap quantity cannot be negative.";
    return null;
  };

  const currentItem = (): PendingProductionItem => ({
    key: crypto.randomUUID(),
    manualSerial,
    productId,
    workOrderId,
    producedQty,
    scrapQty,
  });

  const addProductionItem = () => {
    if (editingId) return;
    const item = currentItem();
    const validationError = validateProductionItem(item);
    if (validationError) return alert(validationError);
    if (pendingItems.some((pending) => pending.manualSerial.trim().toLowerCase() === item.manualSerial.trim().toLowerCase())) {
      return alert("Each production item must have a unique serial number.");
    }
    setPendingItems((current) => [...current, item]);
    setManualSerial(nextProductionSerial(item.manualSerial));
    setWorkOrderId("");
    setProductId("");
    setProducedQty("0");
    setScrapQty("0");
  };

  const handleSave = async () => {
    if (readOnly) return;
    const draftItems = editingId
      ? [currentItem()]
      : [...pendingItems, ...(productId ? [currentItem()] : [])];
    if (draftItems.length === 0) return alert("Add at least one production item.");
    const validationError = draftItems.map(validateProductionItem).find(Boolean);
    if (validationError) return alert(validationError);
    const serials = draftItems.map((item) => item.manualSerial.trim().toLowerCase());
    if (new Set(serials).size !== serials.length) return alert("Each production item must have a unique serial number.");
    setSaving(true);
    setError(null);
    const payloads = draftItems.map((item) => {
      const selectedProduct = products.find((product) => product.id === item.productId);
      const payload: Record<string, unknown> = {
        work_order_id: item.workOrderId || null,
        product_id: item.productId,
        product_name: selectedProduct?.name || null,
        manual_serial_number: item.manualSerial.trim(),
        production_date: productionDate,
        produced_qty: Number(item.producedQty),
        scrap_qty: Number(item.scrapQty || 0),
        posted_at: `${productionDate}T12:00:00`,
        posted_by_staff_id: postedByStaffId || user?.id || null,
      };
      if (orgId) payload.organization_id = orgId;
      return payload;
    });
    const saveQuery = editingId
      ? supabase.from("manufacturing_production_entries").update(payloads[0]).eq("id", editingId)
      : supabase.from("manufacturing_production_entries").insert(payloads);
    const { data: savedRows, error: insertError } = await saveQuery
      .select("id,product_name,production_date,material_cost");
    if (insertError) setError(insertError.message);
    else {
      for (const saved of savedRows || []) {
        const { data: costing } = await supabase
          .from("manufacturing_costing_entries")
          .select("id,period,material_cost,labor_cost,overhead_cost")
          .eq("production_entry_id", saved.id)
          .maybeSingle();
        if (orgId && costing) {
          const totalCost = Number(costing.material_cost || 0) + Number(costing.labor_cost || 0) + Number(costing.overhead_cost || 0);
          if (totalCost > 0) {
            const costAllocation = await productionCostAllocation(saved.id);
            const journal = await createJournalForManufacturingCostingEntry(
              costing.id,
              totalCost,
              saved.product_name || "Product",
              costing.period,
              saved.production_date || productionDate,
              user?.id ?? null,
              orgId,
              costAllocation
            );
            if (!journal.ok) setError(`Production saved, but a costing journal was not posted: ${journal.error}`);
          }
        }
      }
      const nextSerial = editingId ? undefined : nextProductionSerial(draftItems[draftItems.length - 1].manualSerial);
      resetForm(nextSerial);
      await loadEntries();
    }
    setSaving(false);
  };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rowsData.filter((row) => [row.manual_serial_number, row.product_name].some((value) => String(value || "").toLowerCase().includes(q))) : rowsData;
  }, [search, rowsData]);
  const selectedBom = boms.find((bom) => bom.product_id === productId && bom.status === "Active")
    || boms.find((bom) => bom.product_id === productId);
  const visible = (key: ColumnKey) => visibleColumns.includes(key);
  const visibleColumnCount = visibleColumns.length;
  const workOrderName = (id: unknown) => workOrders.find((row) => row.id === id)?.product_name || (id ? "Linked" : "None");
  const staffName = (id: unknown) => staffList.find((row) => row.id === id)?.full_name || "";
  const bomVersion = (id: unknown) => boms.find((row) => row.id === id)?.version || (id ? "Linked" : "");

  return (
    <div className="p-6 md:p-8">
      {readOnly && <ReadOnlyNotice />}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2"><h1 className="text-3xl font-bold text-slate-900">Production Entries</h1><PageNotes ariaLabel="Manufacturing production entries help"><p>Record finished output. Saving an entry adds the produced quantity to finished-goods stock.</p></PageNotes></div>
        <div className="flex items-center gap-2">
          {editingId ? <button type="button" onClick={() => resetForm()} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"><X className="h-4 w-4" />Cancel edit</button> : null}
          <button type="button" onClick={() => void handleSave()} disabled={readOnly || saving} className="app-btn-primary disabled:cursor-not-allowed">{saving ? "Saving..." : editingId ? "Save Changes" : pendingItems.length > 0 ? `Save ${pendingItems.length + (productId ? 1 : 0)} Entries` : "Save Entry"}</button>
        </div>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs text-slate-600">Serial number<input value={manualSerial} onChange={(e) => setManualSerial(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /><span className="mt-1 block text-[11px] text-slate-400">Suggested from the previous entry; you can change it.</span></label>
          <label className="text-xs text-slate-600">Production date<input type="date" value={productionDate} onChange={(e) => setProductionDate(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
          <label className="text-xs text-slate-600">Finished product<select value={productId} onChange={(e) => setProductId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">Select finished product...</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select><span className="mt-1 block text-[11px] text-slate-400">{productId ? selectedBom ? `Uses ${selectedBom.status} BOM ${selectedBom.version}: ${selectedBom.materials.length} material(s) per ${selectedBom.output_qty} output.` : "No BOM found. Create a BOM before recording production." : "Select a product to see its BOM connection."}</span></label>
          <label className="text-xs text-slate-600">Production order (optional)<select value={workOrderId} onChange={(e) => setWorkOrderId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">No production order</option>{workOrders.map((order) => <option key={order.id} value={order.id}>{order.product_name}</option>)}</select></label>
          <label className="text-xs text-slate-600">Employee in charge<select value={postedByStaffId} onChange={(e) => setPostedByStaffId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">{staffList.map((staff) => <option key={staff.id} value={staff.id}>{staff.full_name}</option>)}</select></label>
          <label className="text-xs text-slate-600">Produced quantity<input type="number" min="0.001" step="0.001" value={producedQty} onChange={(e) => setProducedQty(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
          <label className="text-xs text-slate-600">Scrap metal quantity<input type="number" min="0" step="0.001" value={scrapQty} onChange={(e) => setScrapQty(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /><span className="mt-1 block text-[11px] text-slate-400">Automatically increases the Scrap Metal inventory item. Its cost price determines the inventory value transferred from production.</span></label>
          <label className="text-xs text-slate-600">Search<input value={search} onChange={(e) => setSearch(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
          {!editingId ? <div className="flex items-end"><button type="button" onClick={addProductionItem} disabled={readOnly} className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-brand-300 bg-brand-50 px-4 py-2 text-sm font-semibold text-brand-800 hover:bg-brand-100 disabled:opacity-50"><Plus className="h-4 w-4" />Add item</button></div> : null}
        </div>
        {pendingItems.length > 0 ? <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex items-center justify-between gap-3"><p className="text-sm font-semibold text-slate-800">Items ready to save</p><span className="rounded-full bg-brand-100 px-2.5 py-1 text-xs font-bold text-brand-800">{pendingItems.length}</span></div>
          <div className="space-y-2">
            {pendingItems.map((item) => {
              const itemProduct = products.find((product) => product.id === item.productId);
              const itemOrder = workOrders.find((order) => order.id === item.workOrderId);
              return <div key={item.key} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                <div className="min-w-0"><p className="font-semibold text-slate-900">{itemProduct?.name || "Product"}</p><p className="text-xs text-slate-500">Serial {item.manualSerial} · Qty {Number(item.producedQty).toFixed(3)} · Scrap {Number(item.scrapQty || 0).toFixed(3)}{itemOrder ? ` · Order ${itemOrder.product_name}` : ""}</p></div>
                <button type="button" onClick={() => setPendingItems((current) => current.filter((row) => row.key !== item.key))} className="inline-flex items-center gap-1 rounded border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"><Trash2 className="h-3.5 w-3.5" />Remove</button>
              </div>;
            })}
          </div>
        </div> : null}
      </div>
      {error && <p className="my-3 text-sm text-red-600">{error}</p>}
      <div className="relative mt-4 flex justify-end">
        <button type="button" onClick={() => setShowColumns((open) => !open)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"><Settings2 className="h-4 w-4" />Columns</button>
        {showColumns ? <div className="absolute right-0 top-11 z-20 w-56 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
          {COLUMN_OPTIONS.map((column) => <label key={column.key} className="flex items-center gap-2 py-1 text-sm text-slate-700"><input type="checkbox" checked={visible(column.key)} onChange={(event) => setVisibleColumns((current) => event.target.checked ? [...current, column.key] : current.filter((key) => key !== column.key))} />{column.label}</label>)}
        </div> : null}
      </div>
      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm"><thead className="bg-slate-50"><tr>{visible("serial") && <th className="p-3 text-left">Serial number</th>}{visible("date") && <th className="p-3 text-left">Date</th>}{visible("product") && <th className="p-3 text-left">Product</th>}{visible("order") && <th className="p-3 text-left">Production order</th>}{visible("employee") && <th className="p-3 text-left">Employee</th>}{visible("produced") && <th className="p-3 text-right">Produced</th>}{visible("scrap") && <th className="p-3 text-right">Scrap</th>}{visible("materialCost") && <th className="p-3 text-right">Material cost</th>}{visible("bom") && <th className="p-3 text-left">BOM</th>}{visible("actions") && <th className="p-3 text-right">Actions</th>}</tr></thead>
          <tbody>{loading ? <tr><td colSpan={visibleColumnCount} className="p-6 text-center text-slate-500">Loading...</td></tr> : rows.map((row) => <tr key={String(row.id)} className={`border-t ${editingId === row.id ? "bg-blue-50" : ""}`}>{visible("serial") && <td className="p-3 font-medium">{String(row.manual_serial_number || "Not set")}</td>}{visible("date") && <td className="p-3">{String(row.production_date || String(row.posted_at || "").slice(0, 10))}</td>}{visible("product") && <td className="p-3">{String(row.product_name || "")}</td>}{visible("order") && <td className="p-3">{workOrderName(row.work_order_id)}</td>}{visible("employee") && <td className="p-3">{staffName(row.posted_by_staff_id)}</td>}{visible("produced") && <td className="p-3 text-right">{Number(row.produced_qty || 0).toFixed(3)}</td>}{visible("scrap") && <td className="p-3 text-right">{Number(row.scrap_qty || 0).toFixed(3)}</td>}{visible("materialCost") && <td className="p-3 text-right">{Number(row.material_cost || 0).toFixed(2)}</td>}{visible("bom") && <td className="p-3">{bomVersion(row.bom_id)}</td>}{visible("actions") && <td className="p-3 text-right"><button type="button" disabled={readOnly} onClick={() => startEdit(row)} className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-50"><Pencil className="h-3 w-3" />Edit</button></td>}</tr>)}
          {!loading && rows.length === 0 && <tr><td colSpan={visibleColumnCount} className="p-6 text-center text-slate-500">No production entries found.</td></tr>}</tbody>
        </table>
      </div>
    </div>
  );
}
