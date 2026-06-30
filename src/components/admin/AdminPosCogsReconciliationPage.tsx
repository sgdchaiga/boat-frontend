import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import { businessTodayISO } from "../../lib/timezone";

type OrderRow = {
  id: string;
  created_at: string | null;
  order_status: string | null;
  customer_name: string | null;
  table_number: string | null;
};

type OrderItemRow = {
  order_id: string;
  product_id: string | null;
  quantity: number | null;
};

type ProductRow = {
  id: string;
  name: string;
  cost_price: number | null;
  track_inventory: boolean | null;
};

type StockMoveRow = {
  source_id: string | null;
  product_id: string | null;
  quantity_out: number | null;
  unit_cost: number | null;
};

type JournalRow = {
  id: string;
  reference_id: string | null;
};

type JournalLineRow = {
  journal_entry_id: string;
  debit: number | null;
  line_description: string | null;
};

type ReconRow = {
  orderId: string;
  date: string;
  label: string;
  status: "ok" | "review";
  expectedCogs: number;
  postedCogs: number;
  variance: number;
  trackableItems: number;
  stockMovedItems: number;
  missingStockItems: string[];
};

const money = (value: number) =>
  new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", maximumFractionDigits: 0 }).format(value || 0);

const roundMoney = (value: number) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

function monthStart(date: string) {
  return `${date.slice(0, 7)}-01`;
}

export function AdminPosCogsReconciliationPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const today = businessTodayISO();
  const [fromDate, setFromDate] = useState(monthStart(today));
  const [toDate, setToDate] = useState(today);
  const [rows, setRows] = useState<ReconRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      let ordersQuery = (supabase as any)
        .from("kitchen_orders")
        .select("id,created_at,order_status,customer_name,table_number")
        .gte("created_at", `${fromDate}T00:00:00`)
        .lte("created_at", `${toDate}T23:59:59`)
        .order("created_at", { ascending: false });
      ordersQuery = filterByOrganizationId(ordersQuery, orgId, superAdmin);
      const { data: orderData, error: orderError } = await ordersQuery;
      if (orderError) throw orderError;
      const orders = (orderData || []) as OrderRow[];
      const orderIds = orders.map((order) => order.id);
      if (orderIds.length === 0) {
        setRows([]);
        return;
      }

      const [{ data: itemData, error: itemError }, { data: moveData, error: moveError }, journalRes] = await Promise.all([
        (supabase as any)
          .from("kitchen_order_items")
          .select("order_id,product_id,quantity")
          .in("order_id", orderIds),
        (supabase as any)
          .from("product_stock_movements")
          .select("source_id,product_id,quantity_out,unit_cost")
          .eq("source_type", "sale")
          .in("source_id", orderIds),
        filterByOrganizationId(
          (supabase as any)
            .from("journal_entries")
            .select("id,reference_id")
            .eq("reference_type", "pos")
            .eq("is_deleted", false)
            .in("reference_id", orderIds),
          orgId,
          superAdmin
        ),
      ]);
      if (itemError) throw itemError;
      if (moveError) throw moveError;
      if (journalRes.error) throw journalRes.error;

      const items = (itemData || []) as OrderItemRow[];
      const productIds = Array.from(new Set(items.map((item) => item.product_id).filter((id): id is string => !!id)));
      const { data: productData, error: productError } = productIds.length
        ? await (supabase as any)
            .from("products")
            .select("id,name,cost_price,track_inventory")
            .in("id", productIds)
        : { data: [], error: null };
      if (productError) throw productError;
      const products = new Map<string, ProductRow>(
        ((productData || []) as ProductRow[]).map((product) => [product.id, product])
      );

      const journals = (journalRes.data || []) as JournalRow[];
      const journalIds = journals.map((journal) => journal.id);
      const { data: journalLineData, error: journalLineError } = journalIds.length
        ? await (supabase as any)
            .from("journal_entry_lines")
            .select("journal_entry_id,debit,line_description")
            .in("journal_entry_id", journalIds)
        : { data: [], error: null };
      if (journalLineError) throw journalLineError;

      const itemsByOrder = new Map<string, OrderItemRow[]>();
      items.forEach((item) => {
        itemsByOrder.set(item.order_id, [...(itemsByOrder.get(item.order_id) || []), item]);
      });
      const movesByOrder = new Map<string, StockMoveRow[]>();
      ((moveData || []) as StockMoveRow[]).forEach((move) => {
        if (!move.source_id) return;
        movesByOrder.set(move.source_id, [...(movesByOrder.get(move.source_id) || []), move]);
      });
      const journalIdsByOrder = new Map<string, string[]>();
      journals.forEach((journal) => {
        if (!journal.reference_id) return;
        journalIdsByOrder.set(journal.reference_id, [...(journalIdsByOrder.get(journal.reference_id) || []), journal.id]);
      });
      const postedCogsByOrder = new Map<string, number>();
      ((journalLineData || []) as JournalLineRow[]).forEach((line) => {
        const description = String(line.line_description || "").toLowerCase();
        if (!description.includes("purchases (cogs)")) return;
        const orderId = Array.from(journalIdsByOrder.entries()).find(([, ids]) => ids.includes(line.journal_entry_id))?.[0];
        if (!orderId) return;
        postedCogsByOrder.set(orderId, roundMoney((postedCogsByOrder.get(orderId) || 0) + Number(line.debit || 0)));
      });

      const nextRows = orders.map((order) => {
        const orderItems = itemsByOrder.get(order.id) || [];
        const stockMoves = movesByOrder.get(order.id) || [];
        const trackable = orderItems.filter((item) => {
          const product = item.product_id ? products.get(item.product_id) : null;
          return product && product.track_inventory !== false && Number(item.quantity || 0) > 0;
        });
        const stockQtyByProduct = new Map<string, number>();
        stockMoves.forEach((move) => {
          if (!move.product_id) return;
          stockQtyByProduct.set(move.product_id, roundMoney((stockQtyByProduct.get(move.product_id) || 0) + Number(move.quantity_out || 0)));
        });
        const missingStockItems = trackable
          .filter((item) => !item.product_id || (stockQtyByProduct.get(item.product_id) || 0) + 0.0001 < Number(item.quantity || 0))
          .map((item) => (item.product_id ? products.get(item.product_id)?.name || item.product_id : "Missing product"));
        const movementCogs = roundMoney(
          stockMoves.reduce((sum, move) => sum + Number(move.quantity_out || 0) * Number(move.unit_cost || 0), 0)
        );
        const fallbackCogs = roundMoney(
          trackable.reduce((sum, item) => {
            const product = item.product_id ? products.get(item.product_id) : null;
            return sum + Number(item.quantity || 0) * Number(product?.cost_price || 0);
          }, 0)
        );
        const expectedCogs = movementCogs > 0 ? movementCogs : fallbackCogs;
        const postedCogs = postedCogsByOrder.get(order.id) || 0;
        const variance = roundMoney(postedCogs - expectedCogs);
        const status = missingStockItems.length === 0 && Math.abs(variance) <= 0.01 ? "ok" : "review";
        return {
          orderId: order.id,
          date: String(order.created_at || "").slice(0, 10),
          label: order.customer_name || order.table_number || "POS order",
          status,
          expectedCogs,
          postedCogs,
          variance,
          trackableItems: trackable.length,
          stockMovedItems: stockMoves.length,
          missingStockItems,
        } satisfies ReconRow;
      });
      setRows(nextRows);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load POS COGS reconciliation.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [fromDate, toDate, orgId, superAdmin]);

  const summary = useMemo(() => {
    const review = rows.filter((row) => row.status === "review").length;
    return {
      orders: rows.length,
      ok: rows.length - review,
      review,
      expected: rows.reduce((sum, row) => sum + row.expectedCogs, 0),
      posted: rows.reduce((sum, row) => sum + row.postedCogs, 0),
    };
  }, [rows]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">POS COGS reconciliation</h2>
          <p className="text-sm text-slate-500">Review whether each Hotel POS order has stock consumption and matching COGS journal lines.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium text-slate-600">
            From
            <input type="date" className="mt-1 block rounded-lg border px-3 py-2 text-sm" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          </label>
          <label className="text-xs font-medium text-slate-600">
            To
            <input type="date" className="mt-1 block rounded-lg border px-3 py-2 text-sm" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </label>
          <button type="button" onClick={() => void load()} className="app-btn-secondary">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </div>

      {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Orders" value={String(summary.orders)} />
        <Metric label="Clear" value={String(summary.ok)} good />
        <Metric label="Review" value={String(summary.review)} warn={summary.review > 0} />
        <Metric label="Expected COGS" value={money(summary.expected)} />
        <Metric label="Posted COGS" value={money(summary.posted)} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="p-3 text-left">Order</th>
              <th className="p-3 text-left">Date</th>
              <th className="p-3 text-right">Trackable lines</th>
              <th className="p-3 text-right">Stock moves</th>
              <th className="p-3 text-right">Expected COGS</th>
              <th className="p-3 text-right">Posted COGS</th>
              <th className="p-3 text-right">Variance</th>
              <th className="p-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={8} className="p-5 text-center text-slate-500">Loading reconciliation...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="p-5 text-center text-slate-500">No POS orders in this period.</td></tr>
            ) : (
              rows.map((row) => (
                <tr key={row.orderId}>
                  <td className="p-3">
                    <div className="font-medium text-slate-900">{row.label}</div>
                    <div className="font-mono text-xs text-slate-500">{row.orderId}</div>
                  </td>
                  <td className="p-3">{row.date || "-"}</td>
                  <td className="p-3 text-right tabular-nums">{row.trackableItems}</td>
                  <td className="p-3 text-right tabular-nums">{row.stockMovedItems}</td>
                  <td className="p-3 text-right tabular-nums">{money(row.expectedCogs)}</td>
                  <td className="p-3 text-right tabular-nums">{money(row.postedCogs)}</td>
                  <td className={`p-3 text-right tabular-nums font-medium ${Math.abs(row.variance) > 0.01 ? "text-amber-700" : "text-slate-700"}`}>
                    {money(row.variance)}
                  </td>
                  <td className="p-3">
                    {row.status === "ok" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Allocated
                      </span>
                    ) : (
                      <div className="space-y-1">
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
                          <AlertTriangle className="h-3.5 w-3.5" /> Review
                        </span>
                        {row.missingStockItems.length > 0 ? (
                          <div className="text-xs text-slate-500">Missing stock-out: {row.missingStockItems.join(", ")}</div>
                        ) : null}
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Metric({ label, value, good, warn }: { label: string; value: string; good?: boolean; warn?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${warn ? "border-amber-200 bg-amber-50" : good ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-bold text-slate-900">{value}</div>
    </div>
  );
}
