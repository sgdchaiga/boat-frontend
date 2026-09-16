import { Fragment, useEffect, useMemo, useState } from "react";
import { PageNotes } from "../../common/PageNotes";
import { ReadOnlyNotice } from "../../common/ReadOnlyNotice";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../../contexts/AuthContext";
import { filterByOrganizationId } from "../../../lib/supabaseOrgFilter";

type BomMaterial = { item_id: string; item_name: string; qty: number; unit: string };
type BomRow = { id: string; product_id: string; product_name: string; version: string; status: string; output_qty: number; output_unit: string; materials?: BomMaterial[] };
type MaterialVariance = { itemId: string; name: string; unit: string; expected: number; remainingRequired: number; actual: number; available: number };
type OrderPerformance = { produced: number; firstProductionDate: string | null; lastProductionDate: string | null; materialCost: number; laborCost: number; overheadCost: number };

export function ManufacturingWorkOrdersPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!user?.isSuperAdmin;
  const [rowsData, setRowsData] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [bomId, setBomId] = useState("");
  const [boms, setBoms] = useState<BomRow[]>([]);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [materialVariances, setMaterialVariances] = useState<Record<string, MaterialVariance[]>>({});
  const [orderPerformance, setOrderPerformance] = useState<Record<string, OrderPerformance>>({});
  const [loadingMaterials, setLoadingMaterials] = useState<string | null>(null);
  const [reservingOrderId, setReservingOrderId] = useState<string | null>(null);
  const [releasingOrderId, setReleasingOrderId] = useState<string | null>(null);
  const [plannedQty, setPlannedQty] = useState("1");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadOrders();
  }, [orgId, superAdmin]);

  const loadOrders = async () => {
    setLoading(true);
    setError(null);
    try {
      const query = filterByOrganizationId(
        supabase.from("manufacturing_work_orders").select("*"),
        orgId,
        superAdmin
      );
      const { data, error: fetchError } = await query.order("id", { ascending: false });
      if (fetchError) throw fetchError;
      setRowsData((data || []) as Array<Record<string, unknown>>);
      const bomQuery = filterByOrganizationId(
        supabase.from("manufacturing_boms").select("id,product_id,product_name,version,status,output_qty,output_unit,materials").in("status", ["Active", "Draft"]),
        orgId,
        superAdmin
      );
      const { data: bomData, error: bomError } = await bomQuery.order("updated_at", { ascending: false });
      if (bomError) throw bomError;
      setBoms((bomData || []) as BomRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load work orders.");
      setRowsData([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (readOnly) return;
    const selectedBom = boms.find((bom) => bom.id === bomId);
    if (!selectedBom) {
      alert("Select an Active or Draft BOM before creating a production order.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        bom_id: selectedBom.id,
        product_name: selectedBom.product_name,
        planned_qty: Number(plannedQty || 0),
        start_date: startDate || null,
        due_date: dueDate || null,
        status: "Planned",
      };
      if (orgId) payload.organization_id = orgId;
      const { error: insertError } = await supabase.from("manufacturing_work_orders").insert(payload);
      if (insertError) throw insertError;
      setBomId("");
      setPlannedQty("1");
      setStartDate("");
      setDueDate("");
      await loadOrders();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create work order.");
    } finally {
      setSaving(false);
    }
  };

  const rows = useMemo(() => {
    if (!status) return rowsData;
    return rowsData.filter((r) => String(r.status ?? "") === status);
  }, [rowsData, status]);
  const selectedBom = boms.find((bom) => bom.id === bomId);

  const loadMaterialVariance = async (order: Record<string, unknown>) => {
    const orderId = String(order.id || "");
    const currentBom = boms.find((row) => row.id === order.bom_id);
    const snapshot = order.bom_snapshot && typeof order.bom_snapshot === "object" ? order.bom_snapshot as Partial<BomRow> : null;
    const materials = Array.isArray(snapshot?.materials) ? snapshot.materials as BomMaterial[] : currentBom?.materials || [];
    const outputQty = Number(snapshot?.output_qty || currentBom?.output_qty || 0);
    if (!orderId || outputQty <= 0) return;
    setLoadingMaterials(orderId);
    try {
      const entriesQuery = filterByOrganizationId(
        supabase.from("manufacturing_production_entries").select("id,produced_qty,production_date").eq("work_order_id", orderId),
        orgId,
        superAdmin
      );
      const { data: entries, error: entriesError } = await entriesQuery;
      if (entriesError) throw entriesError;
      const productionRows = (entries || []) as Array<{ id: string; produced_qty: number | null; production_date: string | null }>;
      const entryIds = productionRows.map((entry) => entry.id);
      const costingQuery = filterByOrganizationId(
        supabase.from("manufacturing_costing_entries").select("production_entry_id,material_cost,labor_cost,overhead_cost").in("production_entry_id", entryIds),
        orgId,
        superAdmin
      );
      const { data: costingRows, error: costingError } = entryIds.length ? await costingQuery : { data: [], error: null };
      if (costingError) throw costingError;
      const movementsQuery = filterByOrganizationId(
        supabase.from("product_stock_movements").select("product_id,quantity_out").eq("source_type", "manufacturing_consumption").in("source_id", entryIds),
        orgId,
        superAdmin
      );
      const { data: movements, error: movementsError } = entryIds.length
        ? await movementsQuery
        : { data: [], error: null };
      if (movementsError) throw movementsError;
      const actualByProduct = new Map<string, number>();
      for (const movement of (movements || []) as Array<{ product_id: string; quantity_out: number | null }>) {
        actualByProduct.set(movement.product_id, (actualByProduct.get(movement.product_id) || 0) + Number(movement.quantity_out || 0));
      }
      const materialIds = materials.map((material) => material.item_id).filter(Boolean);
      const stockQuery = filterByOrganizationId(
        supabase.from("product_stock_movements").select("product_id,quantity_in,quantity_out").in("product_id", materialIds),
        orgId,
        superAdmin
      );
      const { data: stockRows, error: stockError } = materialIds.length ? await stockQuery : { data: [], error: null };
      if (stockError) throw stockError;
      const availableByProduct = new Map<string, number>();
      for (const movement of (stockRows || []) as Array<{ product_id: string; quantity_in: number | null; quantity_out: number | null }>) {
        availableByProduct.set(movement.product_id, (availableByProduct.get(movement.product_id) || 0) + Number(movement.quantity_in || 0) - Number(movement.quantity_out || 0));
      }
      const produced = productionRows.reduce((sum, entry) => sum + Number(entry.produced_qty || 0), 0);
      const productionDates = productionRows.map((entry) => entry.production_date).filter((date): date is string => !!date).sort();
      const totals = ((costingRows || []) as Array<{ material_cost: number | null; labor_cost: number | null; overhead_cost: number | null }>).reduce((sum, row) => ({
        materialCost: sum.materialCost + Number(row.material_cost || 0),
        laborCost: sum.laborCost + Number(row.labor_cost || 0),
        overheadCost: sum.overheadCost + Number(row.overhead_cost || 0),
      }), { materialCost: 0, laborCost: 0, overheadCost: 0 });
      setOrderPerformance((current) => ({ ...current, [orderId]: { produced, firstProductionDate: productionDates[0] || null, lastProductionDate: productionDates[productionDates.length - 1] || null, ...totals } }));
      const remainingOutput = Math.max(0, Number(order.planned_qty || 0) - produced);
      setMaterialVariances((current) => ({
        ...current,
        [orderId]: materials.map((material) => ({
          itemId: material.item_id,
          name: material.item_name || "Material",
          unit: material.unit || "unit",
          expected: Number(material.qty || 0) * produced / outputQty,
          remainingRequired: Number(material.qty || 0) * remainingOutput / outputQty,
          actual: actualByProduct.get(material.item_id) || 0,
          available: availableByProduct.get(material.item_id) || 0,
        })),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load material usage.");
    } finally {
      setLoadingMaterials(null);
    }
  };

  const toggleMaterials = (order: Record<string, unknown>) => {
    const orderId = String(order.id || "");
    if (expandedOrderId === orderId) { setExpandedOrderId(null); return; }
    setExpandedOrderId(orderId);
    void loadMaterialVariance(order);
  };

  const orderSummary = (order: Record<string, unknown>) => {
    const performance = orderPerformance[String(order.id)];
    if (!performance) return null;
    const planned = Number(order.planned_qty || 0);
    const due = String(order.due_date || "");
    const lastDate = performance.lastProductionDate;
    const complete = planned > 0 && performance.produced >= planned;
    const comparisonDate = complete && lastDate ? lastDate : new Date().toISOString().slice(0, 10);
    const daysFromDue = due ? Math.round((Date.parse(`${comparisonDate}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86400000) : null;
    const totalCost = performance.materialCost + performance.laborCost + performance.overheadCost;
    const money = (value: number) => value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label="Order performance">
      <div className="rounded-lg border bg-white p-3"><p className="text-xs text-slate-500">Output</p><p className="font-semibold">{performance.produced.toFixed(3)} / {planned.toFixed(3)}</p><p className="text-xs text-slate-600">{planned ? Math.min(100, performance.produced / planned * 100).toFixed(1) : "0.0"}% complete · {(performance.produced - planned).toFixed(3)} variance</p></div>
      <div className="rounded-lg border bg-white p-3"><p className="text-xs text-slate-500">Schedule</p><p className={`font-semibold ${daysFromDue !== null && daysFromDue > 0 ? "text-rose-700" : "text-slate-800"}`}>{daysFromDue === null ? "No due date" : daysFromDue > 0 ? `${daysFromDue} days ${complete ? "late" : "overdue"}` : daysFromDue < 0 ? `${-daysFromDue} days ${complete ? "early" : "remaining"}` : "Due today"}</p><p className="text-xs text-slate-600">First output {performance.firstProductionDate || "—"} · latest {lastDate || "—"}</p></div>
      <div className="rounded-lg border bg-white p-3"><p className="text-xs text-slate-500">Actual cost</p><p className="font-semibold">{money(totalCost)}</p><p className="text-xs text-slate-600">Material {money(performance.materialCost)} · labor {money(performance.laborCost)} · overhead {money(performance.overheadCost)}</p></div>
      <div className="rounded-lg border bg-white p-3"><p className="text-xs text-slate-500">Actual unit cost</p><p className="font-semibold">{performance.produced > 0 ? money(totalCost / performance.produced) : "—"}</p><p className="text-xs text-slate-600">Total cost ÷ completed output</p></div>
    </div>;
  };

  const reserveMaterials = async (orderId: string) => {
    if (readOnly) return;
    setReservingOrderId(orderId);
    setError(null);
    try {
      const { error: reserveError } = await (supabase.rpc as any)("reserve_manufacturing_work_order_materials", { p_work_order_id: orderId });
      if (reserveError) throw reserveError;
      await loadOrders();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reserve production materials.");
    } finally {
      setReservingOrderId(null);
    }
  };

  const releaseOrder = async (orderId: string) => {
    if (readOnly) return;
    setReleasingOrderId(orderId);
    setError(null);
    try {
      const { error: releaseError } = await (supabase.rpc as any)("release_manufacturing_work_order", { p_work_order_id: orderId });
      if (releaseError) throw releaseError;
      await loadOrders();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not release production order.");
    } finally {
      setReleasingOrderId(null);
    }
  };

  return (
    <div className="p-6 md:p-8">
      {readOnly && <ReadOnlyNotice />}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-bold text-slate-900">Work Orders</h1>
          <PageNotes ariaLabel="Manufacturing work orders help">
            <p>Create and monitor production jobs from planning to completion.</p>
          </PageNotes>
        </div>
        <button type="button" onClick={handleCreate} disabled={readOnly || saving} className="app-btn-primary disabled:cursor-not-allowed">
          {saving ? "Saving..." : "Save Work Order"}
        </button>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <label className="text-xs text-slate-600">BOM / finished product<select value={bomId} onChange={(e) => setBomId(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"><option value="">Select BOM...</option>{boms.map((bom) => <option key={bom.id} value={bom.id}>{bom.product_name} · {bom.version} · {bom.status}</option>)}</select>{selectedBom ? <span className="mt-1 block text-[11px] text-slate-500">Selected recipe: {selectedBom.output_qty} {selectedBom.output_unit} per batch.</span> : <span className="mt-1 block text-[11px] text-slate-500">A BOM is required before a production order can be created.</span>}</label>
          <label className="text-xs text-slate-600">Planned Quantity<input type="number" min="0" step="0.01" value={plannedQty} onChange={(e) => setPlannedQty(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
          <label className="text-xs text-slate-600">Start Date<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
          <label className="text-xs text-slate-600">Due Date<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
          <label className="text-xs text-slate-600">Filter by Status
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
              <option value="">All</option>
              <option value="Planned">Planned</option>
              <option value="In Progress">In Progress</option>
              <option value="Completed">Completed</option>
            </select>
          </label>
        </div>
      </div>
      {error && <p className="text-sm text-red-600 my-3">{error}</p>}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mt-4">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="p-3 text-left">WO #</th>
              <th className="p-3 text-left">Product</th>
              <th className="p-3 text-left">BOM</th>
              <th className="p-3 text-right">Planned Qty</th>
              <th className="p-3 text-right">Completed</th>
              <th className="p-3 text-left">Start</th>
              <th className="p-3 text-left">Due</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-right">Materials</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={9} className="p-6 text-center text-slate-500">Loading...</td></tr>
            )}
            {rows.map((r) => <Fragment key={String(r.id ?? "")}>
              <tr className="border-t">
                <td className="p-3 font-medium">{String(r.id ?? "")}</td>
                <td className="p-3">{String(r.product_name ?? r.product ?? "")}</td>
                <td className="p-3">{String(r.bom_version || boms.find((bom) => bom.id === r.bom_id)?.version || (r.bom_id ? "Locked" : "—"))}</td>
                <td className="p-3 text-right">{Number(r.planned_qty ?? 0).toFixed(2)}</td>
                <td className="p-3 text-right">{Number(r.completed_qty ?? 0).toFixed(2)}</td>
                <td className="p-3">{String(r.start_date ?? "")}</td>
                <td className="p-3">{String(r.due_date ?? "")}</td>
                <td className="p-3">{String(r.status ?? "")}</td>
                <td className="p-3 text-right"><div className="flex justify-end gap-2"><button type="button" onClick={() => toggleMaterials(r)} className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">{expandedOrderId === r.id ? "Hide" : "Plan vs actual"}</button>{String(r.status) !== "Completed" && String(r.status) !== "Cancelled" && <button type="button" disabled={readOnly || reservingOrderId === r.id} onClick={() => void reserveMaterials(String(r.id))} className="rounded border border-emerald-300 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50">{reservingOrderId === r.id ? "Reserving..." : "Reserve"}</button>}{String(r.status) === "Planned" && <button type="button" disabled={readOnly || releasingOrderId === r.id} onClick={() => void releaseOrder(String(r.id))} className="rounded border border-blue-300 px-2 py-1 text-xs font-medium text-blue-800 hover:bg-blue-50 disabled:opacity-50">{releasingOrderId === r.id ? "Releasing..." : "Release"}</button>}</div></td>
              </tr>
              {expandedOrderId === r.id && <tr className="border-t bg-slate-50"><td colSpan={9} className="p-4">{loadingMaterials === r.id ? <p className="text-sm text-slate-500">Loading order report...</p> : <div>{orderSummary(r)}<p className="mb-2 text-sm font-semibold text-slate-800">Material plan, live stock and actual consumption</p>{(materialVariances[String(r.id)] || []).length ? <div className="overflow-x-auto"><table className="min-w-[760px] text-sm"><thead className="text-left text-xs text-slate-500"><tr><th className="pr-6 pb-1">Material</th><th className="pr-6 pb-1 text-right">Available</th><th className="pr-6 pb-1 text-right">Need to finish</th><th className="pr-6 pb-1 text-right">Expected used</th><th className="pr-6 pb-1 text-right">Actual</th><th className="pb-1 text-right">Variance</th></tr></thead><tbody>{(materialVariances[String(r.id)] || []).map((material) => <tr key={material.itemId}><td className="pr-6 py-1">{material.name} <span className="text-xs text-slate-500">({material.unit})</span></td><td className={`pr-6 py-1 text-right font-medium ${material.available + 0.001 < material.remainingRequired ? "text-rose-700" : "text-emerald-700"}`}>{material.available.toFixed(3)}{material.available + 0.001 < material.remainingRequired ? " · Short" : " · Ready"}</td><td className="pr-6 py-1 text-right">{material.remainingRequired.toFixed(3)}</td><td className="pr-6 py-1 text-right">{material.expected.toFixed(3)}</td><td className="pr-6 py-1 text-right">{material.actual.toFixed(3)}</td><td className={`py-1 text-right font-medium ${Math.abs(material.actual - material.expected) > 0.001 ? "text-amber-700" : "text-emerald-700"}`}>{(material.actual - material.expected).toFixed(3)}</td></tr>)}</tbody></table></div> : <p className="text-sm text-slate-500">This BOM has no material lines.</p>}</div>}</td></tr>}
            </Fragment>)}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={9} className="p-6 text-center text-slate-500">No work orders found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
