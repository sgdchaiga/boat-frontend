import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { PageNotes } from "../common/PageNotes";

interface Product {
  id: string;
  name: string;
  track_inventory?: boolean | null;
}

interface BalanceRow {
  product_id: string;
  product_name: string;
  qty_in: number;
  qty_out: number;
  balance: number;
}

export function StockBalancesPage() {
  const [rows, setRows] = useState<BalanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [lowStockThreshold, setLowStockThreshold] = useState("5");
  const [showLowOnly, setShowLowOnly] = useState(false);

  useEffect(() => {
    loadBalances();
  }, []);

  const loadBalances = async () => {
    setLoading(true);
    setError(null);
    try {
      const [productsRes, movesRes] = await Promise.all([
        supabase
          .from("products")
          .select("id,name,track_inventory")
          .order("name"),
        supabase
          .from("product_stock_movements")
          .select("product_id,quantity_in,quantity_out"),
      ]);

      if (productsRes.error) throw productsRes.error;
      if (movesRes.error) throw movesRes.error;

      const products = (productsRes.data || []) as Product[];
      const moves = (movesRes.data || []) as Array<{
        product_id: string;
        quantity_in: number | null;
        quantity_out: number | null;
      }>;

      const map: Record<string, BalanceRow> = {};
      products.forEach((p) => {
        if ((p.track_inventory ?? true) === false) return;
        map[p.id] = {
          product_id: p.id,
          product_name: p.name,
          qty_in: 0,
          qty_out: 0,
          balance: 0,
        };
      });

      moves.forEach((m) => {
        if (!map[m.product_id]) return;
        map[m.product_id].qty_in += Number(m.quantity_in || 0);
        map[m.product_id].qty_out += Number(m.quantity_out || 0);
      });

      const result = Object.values(map)
        .map((r) => ({
          ...r,
          balance: r.qty_in - r.qty_out,
        }))
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
            <h1 className="text-3xl font-bold text-slate-900">Current Stock Balances</h1>
            <PageNotes ariaLabel="Stock balances help">
              <p>Live on-hand quantity per inventory item.</p>
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
                <th className="p-3 text-right">On Hand</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => {
                const isLow = r.balance <= threshold;
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
                  </tr>
                );
              })}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-slate-500">
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
