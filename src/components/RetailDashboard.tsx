import { useEffect, useMemo, useState } from "react";
import {
  Box,
  CreditCard,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  Truck,
  BarChart3,
  Store,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { computeRangeInTimezone, type DateRangeKey, toBusinessDateString } from "../lib/timezone";
import { useAuth } from "../contexts/AuthContext";
import { filterByOrganizationId } from "../lib/supabaseOrgFilter";
import {
  aggregateRetailByBusinessDay,
  isRetailPosPayment,
  sumByMethod,
  type DashboardPayment,
} from "../lib/dashboardPaymentFilters";
import { fetchKitchenOrderIdsForPayments } from "../lib/dashboardKitchenLookup";
import { PageNotes } from "./common/PageNotes";

interface RetailDashboardProps {
  onNavigate?: (page: string) => void;
}

type SalesRange = "today" | "this_week" | "this_month";

function formatMoney(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function priorRangeKey(range: SalesRange): DateRangeKey {
  if (range === "today") return "yesterday";
  if (range === "this_week") return "last_week";
  return "last_month";
}

function last7BusinessDayKeys(): string[] {
  const keys: string[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    keys.push(toBusinessDateString(d));
  }
  return keys;
}

function pctChange(current: number, prior: number): number | null {
  if (prior === 0) return current === 0 ? 0 : null;
  return ((current - prior) / prior) * 100;
}

export function RetailDashboard({ onNavigate }: RetailDashboardProps) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [salesRange, setSalesRange] = useState<SalesRange>("this_week");

  const [revenue, setRevenue] = useState(0);
  const [priorRevenue, setPriorRevenue] = useState(0);
  const [txnCount, setTxnCount] = useState(0);
  const [priorTxnCount, setPriorTxnCount] = useState(0);
  const [methodMix, setMethodMix] = useState<Record<string, number>>({});
  const [dailyRetail, setDailyRetail] = useState<Record<string, number>>({});

  const [productsCount, setProductsCount] = useState(0);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [lowStockTop, setLowStockTop] = useState<Array<{ product_id: string; name: string; balance: number }>>([]);
  const [lowStockThreshold, setLowStockThreshold] = useState(5);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setLoadError(null);
      const dayKeys7 = last7BusinessDayKeys();
      try {
        const { from: curFrom, to: curTo } = computeRangeInTimezone(salesRange, "", "");
        const { from: prFrom, to: prTo } = computeRangeInTimezone(priorRangeKey(salesRange), "", "");
        const { from: from7, to: to7 } = computeRangeInTimezone("last_7_days", "", "");

        const minFrom = new Date(Math.min(curFrom.getTime(), prFrom.getTime(), from7.getTime()));
        const maxTo = new Date(Math.max(curTo.getTime(), prTo.getTime(), to7.getTime()));

        let payQ = supabase
          .from("payments")
          .select("id, transaction_id, paid_at, amount, payment_method, payment_status, stay_id, payment_source")
          .eq("payment_status", "completed")
          .gte("paid_at", minFrom.toISOString())
          .lt("paid_at", maxTo.toISOString());
        payQ = filterByOrganizationId(payQ, orgId, superAdmin);

        const [paymentsRes, productsRes, movesRes] = await Promise.all([
          payQ,
          filterByOrganizationId(
            supabase.from("products").select("id, name, track_inventory").eq("active", true),
            orgId,
            superAdmin
          ),
          supabase.from("product_stock_movements").select("product_id, quantity_in, quantity_out"),
        ]);

        if (cancelled) return;

        if (paymentsRes.error) throw new Error(paymentsRes.error.message);
        const allPayments = (paymentsRes.data || []) as DashboardPayment[];

        const kitchenIds = await fetchKitchenOrderIdsForPayments(allPayments, orgId, superAdmin);

        const inRange = (p: DashboardPayment, from: Date, to: Date) => {
          const t = new Date(p.paid_at || 0).getTime();
          return t >= from.getTime() && t < to.getTime();
        };

        const currentList = allPayments.filter((p) => inRange(p, curFrom, curTo));
        const priorList = allPayments.filter((p) => inRange(p, prFrom, prTo));
        const chartList = allPayments.filter((p) => inRange(p, from7, to7));

        const retailCurrent = currentList.filter((p) => isRetailPosPayment(p, kitchenIds));
        const retailPrior = priorList.filter((p) => isRetailPosPayment(p, kitchenIds));

        const totalRev = retailCurrent.reduce((s, p) => s + Number(p.amount ?? 0), 0);
        const totalPrior = retailPrior.reduce((s, p) => s + Number(p.amount ?? 0), 0);
        setRevenue(totalRev);
        setPriorRevenue(totalPrior);
        setTxnCount(retailCurrent.length);
        setPriorTxnCount(retailPrior.length);
        setMethodMix(sumByMethod(currentList, (p) => isRetailPosPayment(p, kitchenIds)));

        const byDay = aggregateRetailByBusinessDay(chartList, kitchenIds, dayKeys7);
        setDailyRetail(byDay);

        const products = (productsRes.data || []) as Array<{ id: string; name: string; track_inventory: boolean | null }>;
        setProductsCount(products.length);

        const map: Record<string, { product_id: string; name: string; balance: number; track_inventory: boolean }> = {};
        for (const p of products) {
          const track = (p.track_inventory ?? true) === true;
          if (!track) continue;
          map[p.id] = { product_id: p.id, name: p.name, balance: 0, track_inventory: true };
        }

        const moves = (movesRes.data || []) as Array<{
          product_id: string;
          quantity_in: number | null;
          quantity_out: number | null;
        }>;
        for (const m of moves) {
          if (!map[m.product_id]) continue;
          map[m.product_id].balance += Number(m.quantity_in || 0) - Number(m.quantity_out || 0);
        }

        const lowItems = Object.values(map)
          .map((r) => ({ ...r, balance: Number(r.balance || 0) }))
          .sort((a, b) => a.balance - b.balance);

        const lowItemsFiltered = lowItems.filter((i) => i.balance <= lowStockThreshold);
        setLowStockCount(lowItemsFiltered.length);
        setLowStockTop(lowItems.slice(0, 5));
      } catch (e) {
        console.error("Retail dashboard load error:", e);
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Failed to load dashboard");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [salesRange, lowStockThreshold, orgId, superAdmin]);

  const avgTicket = txnCount > 0 ? revenue / txnCount : 0;
  const priorAvg = priorTxnCount > 0 ? priorRevenue / priorTxnCount : 0;
  const revPct = pctChange(revenue, priorRevenue);
  const txnPct = pctChange(txnCount, priorTxnCount);

  const methodRows = useMemo(() => {
    return Object.entries(methodMix)
      .map(([k, v]) => ({ label: k, value: v }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [methodMix]);

  const chartDays = useMemo(() => last7BusinessDayKeys(), []);
  const maxDay = useMemo(
    () => Math.max(0.01, ...chartDays.map((d) => dailyRetail[d] ?? 0)),
    [dailyRetail, chartDays]
  );

  const rangeLabel =
    salesRange === "today" ? "Today" : salesRange === "this_week" ? "This week" : "This month";

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] p-6 md:p-8 bg-gradient-to-br from-slate-50 via-slate-100/30 to-amber-50/40">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-slate-200 rounded w-56" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-32 bg-slate-200 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] p-6 md:p-8 bg-gradient-to-br from-slate-50 via-slate-100/30 to-amber-50/40">
      <div className="mb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold text-slate-900">Retail Dashboard</h1>
            <PageNotes ariaLabel="Retail dashboard help">
              <p>Sales, payment mix, and inventory health.</p>
            </PageNotes>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-slate-600">Sales period</label>
          <select
            value={salesRange}
            onChange={(e) => setSalesRange(e.target.value as SalesRange)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value="today">Today</option>
            <option value="this_week">This week</option>
            <option value="this_month">This month</option>
          </select>
        </div>
      </div>

      {loadError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{loadError}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-xl p-6 border border-slate-200 hover:shadow-lg transition">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-amber-100 p-3 rounded-lg">
              <ShoppingBag className="w-6 h-6 text-amber-800" />
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-slate-900">{formatMoney(revenue)}</p>
              <p className="text-xs text-slate-500">{rangeLabel} · retail POS</p>
            </div>
          </div>
          <p className="text-slate-700 font-medium">Gross sales</p>
          {revPct !== null && (
            <p className={`text-xs mt-1 flex items-center gap-1 ${revPct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
              <TrendingUp className={`w-3.5 h-3.5 ${revPct < 0 ? "hidden" : ""}`} />
              <TrendingDown className={`w-3.5 h-3.5 ${revPct >= 0 ? "hidden" : ""}`} />
              {revPct >= 0 ? "+" : ""}
              {revPct.toFixed(1)}% vs prior period
            </p>
          )}
        </div>

        <div className="bg-white rounded-xl p-6 border border-slate-200 hover:shadow-lg transition">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-slate-100 p-3 rounded-lg">
              <Store className="w-6 h-6 text-slate-700" />
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-slate-900">{txnCount}</p>
              <p className="text-sm text-slate-500">transactions</p>
            </div>
          </div>
          <p className="text-slate-700 font-medium">Ticket count</p>
          {txnPct !== null && (
            <p className={`text-xs mt-1 ${txnPct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
              {txnPct >= 0 ? "+" : ""}
              {txnPct.toFixed(1)}% vs prior · Avg {formatMoney(avgTicket)}
              {priorTxnCount > 0 && <span className="text-slate-400"> (was {formatMoney(priorAvg)})</span>}
            </p>
          )}
        </div>

        <div className="bg-white rounded-xl p-6 border border-slate-200 hover:shadow-lg transition">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-slate-100 p-3 rounded-lg">
              <Box className="w-6 h-6 text-slate-700" />
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-slate-900">{productsCount}</p>
              <p className="text-sm text-slate-500">Active SKUs</p>
            </div>
          </div>
          <p className="text-slate-700 font-medium">Product catalog</p>
        </div>

        <div className="bg-white rounded-xl p-6 border border-slate-200 hover:shadow-lg transition">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-rose-50 p-3 rounded-lg">
              <TrendingDown className="w-6 h-6 text-rose-700" />
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-slate-900">{lowStockCount}</p>
              <p className="text-sm text-slate-500">≤ {lowStockThreshold} units</p>
            </div>
          </div>
          <p className="text-slate-700 font-medium">Low stock alerts</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-white rounded-xl p-6 border border-slate-200">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-5 h-5 text-slate-700" />
            <h2 className="text-lg font-bold text-slate-900">Last 7 days — retail sales</h2>
          </div>
          <p className="text-xs text-slate-500 mb-4">Rolling business days (Kampala). Height = share of the week max.</p>
          <div className="flex items-end justify-between gap-1 h-36 border-b border-slate-200 pb-1">
            {chartDays.map((d) => {
              const v = dailyRetail[d] ?? 0;
              const hPx = maxDay > 0 ? Math.max(3, Math.round((v / maxDay) * 120)) : 3;
              return (
                <div key={d} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0">
                  <div
                    className="w-full max-w-[44px] mx-auto rounded-t bg-gradient-to-t from-brand-700 to-brand-500 transition-all"
                    style={{ height: `${hPx}px` }}
                    title={`${d}: ${formatMoney(v)}`}
                  />
                  <span className="text-[10px] text-slate-500 truncate w-full text-center">{d.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white rounded-xl p-6 border border-slate-200">
          <div className="flex items-center gap-2 mb-4">
            <CreditCard className="w-5 h-5 text-slate-700" />
            <h2 className="text-lg font-bold text-slate-900">Payment mix ({rangeLabel})</h2>
          </div>
          {methodRows.length === 0 ? (
            <p className="text-sm text-slate-500">No retail sales in this period.</p>
          ) : (
            <ul className="space-y-3">
              {methodRows.map((r) => {
                const share = revenue > 0 ? (r.value / revenue) * 100 : 0;
                return (
                  <li key={r.label}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-slate-700 capitalize">{r.label}</span>
                      <span className="font-medium text-slate-900">
                        {formatMoney(r.value)} <span className="text-slate-400">({share.toFixed(0)}%)</span>
                      </span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-brand-600 rounded-full" style={{ width: `${share}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 border border-slate-200 mb-6">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-1">Stock alerts</h2>
            <p className="text-slate-600 text-sm">Tracked products with the lowest on-hand balance</p>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm text-slate-700">Low stock threshold</label>
            <input
              type="number"
              min={0}
              value={lowStockThreshold}
              onChange={(e) => setLowStockThreshold(Number(e.target.value))}
              className="w-28 border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-slate-50 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Truck className="w-5 h-5 text-slate-700" />
              <p className="font-semibold text-slate-900">Below threshold</p>
            </div>
            <p className="text-3xl font-bold text-amber-700">{lowStockCount}</p>
            <p className="text-sm text-slate-600 mt-1">Products at or below {lowStockThreshold} units on hand</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-4">
            <p className="font-semibold text-slate-900 mb-3">Lowest balances</p>
            <div className="space-y-2">
              {lowStockTop.length === 0 ? (
                <p className="text-sm text-slate-600">No inventory records found.</p>
              ) : (
                lowStockTop.map((i) => (
                  <div key={i.product_id} className="flex items-center justify-between gap-3">
                    <span className="text-sm text-slate-700 truncate pr-2">{i.name}</span>
                    <span className="text-sm font-semibold text-slate-900">{i.balance.toFixed(2)}</span>
                  </div>
                ))
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onNavigate?.("retail_pos")}
                className="px-4 py-2 bg-brand-700 text-white text-sm rounded-lg hover:bg-brand-800 transition"
              >
                Open retail POS
              </button>
              <button
                type="button"
                onClick={() => onNavigate?.("inventory_stock_balances")}
                className="px-4 py-2 border border-slate-300 text-slate-800 text-sm rounded-lg hover:bg-slate-50 transition"
              >
                Stock balances
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
