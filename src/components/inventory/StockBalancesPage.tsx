import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import { ensureActiveOrganization } from "../../lib/stockBulkImport";
import { fetchStockLedgerMovementsForProducts } from "../../lib/stockLedger";
import { PageNotes } from "../common/PageNotes";
import { effectiveStockMovementInOut } from "../../lib/stockMovementEffective";
import { businessDayRangeForDateString, businessTodayISO } from "../../lib/timezone";

interface Product {
  id: string;
  name: string;
  track_inventory?: boolean | null;
  reorder_level?: number | null;
  reorder_lead_days?: number | null;
  is_food_item?: boolean | null;
}

interface BalanceRow {
  product_id: string;
  product_name: string;
  qty_in: number;
  qty_out: number;
  balance: number;
  daily_use: number;
  days_cover: number | null;
  reorder_point: number;
  is_food: boolean;
}

export function StockBalancesPage() {
  const { user, isSuperAdmin } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = Boolean(isSuperAdmin);
  const [rows, setRows] = useState<BalanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [lowStockThreshold, setLowStockThreshold] = useState("5");
  const [showLowOnly, setShowLowOnly] = useState(false);
  const [asAtDate, setAsAtDate] = useState(businessTodayISO);

  useEffect(() => {
    void loadBalances();
  }, [orgId, superAdmin, asAtDate]);

  const loadBalances = async () => {
    setLoading(true);
    setError(null);
    try {
      if (orgId) {
        await ensureActiveOrganization(orgId);
      }

      const [productsRes, orgRes] = await Promise.all([filterByOrganizationId(
        supabase.from("products").select("id,name,track_inventory,reorder_level,reorder_lead_days,is_food_item").order("name"),
        orgId,
        superAdmin
      ), orgId ? supabase.from("organizations").select("school_term_end_date").eq("id",orgId).maybeSingle() : Promise.resolve({data:null,error:null})]);
      if (productsRes.error) throw productsRes.error;

      const products = (productsRes.data || []) as Product[];
      const productIds = products.map((p) => p.id);
      const moves = await fetchStockLedgerMovementsForProducts(orgId, productIds);

      const asAtEnd = businessDayRangeForDateString(asAtDate)?.to.getTime() ?? Number.POSITIVE_INFINITY;

      const map: Record<string, BalanceRow> = {};
      products.forEach((p) => {
        if ((p.track_inventory ?? true) === false) return;
        map[p.id] = {
          product_id: p.id,
          product_name: p.name,
          qty_in: 0,
          qty_out: 0,
          balance: 0,
          daily_use: 0,
          days_cover: null,
          reorder_point: Number(p.reorder_level||0),
          is_food: p.is_food_item === true,
        };
      });

      moves.forEach((m) => {
        if (!map[m.product_id]) return;
        const movementMs = new Date(m.movement_date || "").getTime();
        if (!Number.isFinite(movementMs) || movementMs >= asAtEnd) return;
        const { inQty, outQty } = effectiveStockMovementInOut(m);
        map[m.product_id].qty_in += inQty;
        map[m.product_id].qty_out += outQty;
        const ageDays = (asAtEnd - movementMs) / 86400000;
        if (ageDays >= 0 && ageDays <= 30) map[m.product_id].daily_use += outQty / 30;
      });

      const termEndRaw=(orgRes.data as {school_term_end_date?:string|null}|null)?.school_term_end_date;
      const daysToTermEnd=termEndRaw?Math.max(0,Math.ceil((new Date(termEndRaw).getTime()-new Date(asAtDate).getTime())/86400000)):null;

      const result = Object.values(map)
        .map((r) => {
          const balance=r.qty_in-r.qty_out;
          const product=products.find(p=>p.id===r.product_id);
          const lead=Math.min(Number(product?.reorder_lead_days??7),daysToTermEnd??Number(product?.reorder_lead_days??7));
          const reorder=Math.max(r.reorder_point,r.daily_use*lead);
          return {...r,balance,reorder_point:reorder,days_cover:r.daily_use>0?balance/r.daily_use:null};
        })
        .sort((a, b) => a.product_name.localeCompare(b.product_name));

      setRows(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load stock balances.");
    } finally {
      setLoading(false);
    }
  };

  const threshold = Number(lowStockThreshold || 0);
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !r.product_name.toLowerCase().includes(q)) return false;
      if (showLowOnly && r.balance > threshold) return false;
      return true;
    });
  }, [rows, search, showLowOnly, threshold]);

  return (
    <div className="p-6 md:p-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold text-slate-900">Stock Balances</h1>
            <PageNotes ariaLabel="Stock balances help">
              <p>On-hand quantity per inventory item at the end of the selected business date.</p>
            </PageNotes>
          </div>
        </div>
        <button
          type="button"
          onClick={loadBalances}
          className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 text-sm"
        >
          Refresh
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <label className="text-sm text-slate-700">
            <span className="mb-1 block font-medium">Balance as at</span>
            <input
              type="date"
              value={asAtDate}
              onChange={(e) => setAsAtDate(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search item..."
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
          <input
            type="number"
            min="0"
            step="0.01"
            value={lowStockThreshold}
            onChange={(e) => setLowStockThreshold(e.target.value)}
            placeholder="Low-stock threshold"
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={showLowOnly}
              onChange={(e) => setShowLowOnly(e.target.checked)}
            />
            Show low stock only
          </label>
        </div>
      </div>

      {error ? (
        <p className="text-red-600 text-sm">{error}</p>
      ) : loading ? (
        <p className="text-slate-500 text-sm">Loading balances...</p>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="p-3 text-left">Item</th>
                <th className="p-3 text-right">Total In</th>
                <th className="p-3 text-right">Total Out</th>
                <th className="p-3 text-right">On Hand</th><th className="p-3 text-right">Daily use</th><th className="p-3 text-right">Days left</th><th className="p-3 text-right">Reorder point</th><th className="p-3 text-left">Signal</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => {
                const isLow = r.balance <= Math.max(threshold,r.reorder_point);
                return (
                  <tr key={r.product_id} className="border-t">
                    <td className="p-3">{r.product_name}</td>
                    <td className="p-3 text-right">{r.qty_in.toFixed(2)}</td>
                    <td className="p-3 text-right">{r.qty_out.toFixed(2)}</td>
                    <td
                      className={`p-3 text-right font-semibold ${
                        isLow ? "text-amber-700" : "text-slate-900"
                      }`}
                    >
                      {r.balance.toFixed(2)}
                    </td>
                    <td className="p-3 text-right">{r.daily_use.toFixed(2)}</td><td className="p-3 text-right">{r.days_cover==null?'—':Math.max(0,r.days_cover).toFixed(1)}</td><td className="p-3 text-right">{r.reorder_point.toFixed(2)}</td><td className="p-3">{isLow?<span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">⚠ Reorder</span>:<span className="text-xs text-emerald-700">Adequate</span>}</td>
                  </tr>
                );
              })}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-slate-500">
                    No stock items found for current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
