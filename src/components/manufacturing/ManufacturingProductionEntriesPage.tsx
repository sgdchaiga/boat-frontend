import { useEffect, useMemo, useState } from "react";
import { PageNotes } from "../common/PageNotes";
import { ReadOnlyNotice } from "../common/ReadOnlyNotice";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";

type WorkOrderRow = { id: string; product_name: string };
type StaffRow = { id: string; full_name: string };

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
  const [workOrderId, setWorkOrderId] = useState("");
  const [postedByStaffId, setPostedByStaffId] = useState("");
  const [product, setProduct] = useState("");
  const [producedQty, setProducedQty] = useState("0");
  const [scrapQty, setScrapQty] = useState("0");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadEntries();
    void loadRefs();
  }, [orgId, superAdmin]);

  useEffect(() => {
    if (user?.id && !postedByStaffId) {
      setPostedByStaffId(user.id);
    }
  }, [user?.id, postedByStaffId]);

  const loadRefs = async () => {
    if (!orgId && !superAdmin) return;
    try {
      const [woRes, stRes] = await Promise.all([
        filterByOrganizationId(
          supabase.from("manufacturing_work_orders").select("id,product_name").order("created_at", { ascending: false }),
          orgId,
          superAdmin
        ),
        filterByOrganizationId(supabase.from("staff").select("id,full_name").order("full_name"), orgId, superAdmin),
      ]);
      if (woRes.error) console.warn(woRes.error);
      if (stRes.error) console.warn(stRes.error);
      setWorkOrders((woRes.data || []) as WorkOrderRow[]);
      setStaffList((stRes.data || []) as StaffRow[]);
    } catch {
      /* ignore */
    }
  };

  const loadEntries = async () => {
    setLoading(true);
    setError(null);
    try {
      const query = filterByOrganizationId(
        supabase.from("manufacturing_production_entries").select("*"),
        orgId,
        superAdmin
      );
      const { data, error: fetchError } = await query.order("posted_at", { ascending: false });
      if (fetchError) throw fetchError;
      setRowsData((data || []) as Array<Record<string, unknown>>);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load production entries.");
      setRowsData([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (readOnly) return;
    if (!workOrderId.trim()) {
      alert("Select a work order.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        work_order_id: workOrderId.trim(),
        product_name: product.trim() || null,
        produced_qty: Number(producedQty || 0),
        scrap_qty: Number(scrapQty || 0),
        posted_at: new Date().toISOString(),
        posted_by_staff_id: postedByStaffId || user?.id || null,
      };
      if (orgId) payload.organization_id = orgId;
      const { error: insertError } = await supabase.from("manufacturing_production_entries").insert(payload);
      if (insertError) throw insertError;
      setWorkOrderId("");
      setProduct("");
      setProducedQty("0");
      setScrapQty("0");
      setPostedByStaffId(user?.id || "");
      await loadEntries();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create production entry.");
    } finally {
      setSaving(false);
    }
  };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? rowsData.filter((r) => String(r.id ?? "").toLowerCase().includes(q) || String(r.work_order_id ?? "").toLowerCase().includes(q))
      : rowsData;
  }, [search, rowsData]);

  return (
    <div className="p-6 md:p-8">
      {readOnly && <ReadOnlyNotice />}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-bold text-slate-900">Production Entries</h1>
          <PageNotes ariaLabel="Manufacturing production entries help">
            <p>Capture finished output and scrap before inventory/GL posting.</p>
          </PageNotes>
        </div>
        <button type="button" onClick={() => void handleCreate()} disabled={readOnly || saving} className="app-btn-primary disabled:cursor-not-allowed">
          {saving ? "Saving..." : "Save Entry"}
        </button>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <label className="text-xs text-slate-600">
            Work order
            <select
              value={workOrderId}
              onChange={(e) => {
                const id = e.target.value;
                setWorkOrderId(id);
                const wo = workOrders.find((w) => w.id === id);
                if (wo?.product_name) setProduct(wo.product_name);
              }}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Select work order…</option>
              {workOrders.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.product_name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Employee in charge
            <select
              value={postedByStaffId}
              onChange={(e) => setPostedByStaffId(e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Product (override)
            <input value={product} onChange={(e) => setProduct(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="text-xs text-slate-600">
            Produced quantity
            <input type="number" min="0" step="0.01" value={producedQty} onChange={(e) => setProducedQty(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="text-xs text-slate-600">
            Scrap quantity
            <input type="number" min="0" step="0.01" value={scrapQty} onChange={(e) => setScrapQty(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="text-xs text-slate-600">
            Search
            <input value={search} onChange={(e) => setSearch(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </label>
        </div>
      </div>
      {error && <p className="text-sm text-red-600 my-3">{error}</p>}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mt-4">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="p-3 text-left">Entry #</th>
              <th className="p-3 text-left">Work Order</th>
              <th className="p-3 text-left">Product</th>
              <th className="p-3 text-right">Produced</th>
              <th className="p-3 text-right">Scrap</th>
              <th className="p-3 text-left">Posted</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-slate-500">
                  Loading...
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={String(r.id ?? "")} className="border-t">
                <td className="p-3 font-medium">{String(r.id ?? "").slice(0, 8)}…</td>
                <td className="p-3">{String(r.work_order_id ?? "")}</td>
                <td className="p-3">{String(r.product_name ?? r.product ?? "")}</td>
                <td className="p-3 text-right">{Number(r.produced_qty ?? 0).toFixed(2)}</td>
                <td className="p-3 text-right">{Number(r.scrap_qty ?? 0).toFixed(2)}</td>
                <td className="p-3">{String(r.posted_at ?? r.created_at ?? "")}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-slate-500">
                  No production entries found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
