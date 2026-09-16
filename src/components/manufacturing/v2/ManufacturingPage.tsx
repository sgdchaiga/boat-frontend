import {
  ArrowRight,
  ClipboardList,
  Factory,
  FileText,
  Gauge,
  PackageCheck,
  PackageOpen,
  Route,
  Scale,
  ShoppingCart,
  Warehouse,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ReadOnlyNotice } from "../../common/ReadOnlyNotice";
import { useAuth } from "../../../contexts/AuthContext";
import { supabase } from "../../../lib/supabase";
import { filterByOrganizationId } from "../../../lib/supabaseOrgFilter";

type Props = {
  onNavigate?: (page: string, state?: Record<string, unknown>) => void;
  readOnly?: boolean;
};

const reportCards = [
  {
    title: "Daily production report",
    desc: "Date, product, quantity produced, and employee in charge for the selected period.",
    page: "reports_manufacturing_daily_production",
    icon: FileText,
  },
  {
    title: "Inventory valuation",
    desc: "Raw materials, WIP, finished goods, stock movement, and valuation reports.",
    page: "reports_stock_summary",
    icon: Warehouse,
  },
  {
    title: "WIP report",
    desc: "Opening WIP, production costs added, completed transfers, and closing WIP.",
    page: "manufacturing_wip_report",
    icon: Route,
  },
  {
    title: "Materials & cost of production",
    desc: "Raw material balances as of a date, batch material usage, and cost of production statement.",
    page: "manufacturing_account",
    icon: Factory,
  },
  {
    title: "Manufacturing P&L",
    desc: "Product sales, COGS, factory overhead, and operating profit.",
    page: "accounting_income",
    icon: Scale,
  },
] as const;

const salesCards = [
  {
    title: "Counter POS",
    desc: "Same barcode/till flow as retail — sell finished goods or stock items at the counter.",
    page: "retail_pos",
    icon: ShoppingCart,
  },
  {
    title: "POS orders",
    desc: "Review, edit payments, or reverse recorded counter sales.",
    page: "retail_pos_orders",
    icon: ClipboardList,
  },
] as const;

const starterCards = [
  {
    title: "Job cards",
    desc: "Start, block, and complete released routing steps while recording actual time.",
    page: "manufacturing_job_cards",
  },
  {
    title: "Work centres & routings",
    desc: "Set factory work centres and ordered production steps that become job cards on order release.",
    page: "manufacturing_operations",
  },
  {
    title: "Bill of materials",
    desc: "Define raw materials, waste, packaging, labour, stages, and machine time.",
    page: "manufacturing_bom",
  },
  {
    title: "Work orders",
    desc: "Issue production jobs, assign dates, and track execution status.",
    page: "manufacturing_work_orders",
  },
  {
    title: "Production entries",
    desc: "Issue materials, apply labour and overhead, then complete output.",
    page: "manufacturing_production_entries",
  },
  {
    title: "Costing",
    desc: "Review batch cost, unit cost, yield, scrap, and WIP transfer.",
    page: "manufacturing_costing",
  },
  {
    title: "Cost allocation",
    desc: "Allocate overhead by cost centre, driver basis, and production batch.",
    page: "accounting_cost_allocation",
  },
] as const;

const accountingFlow = [
  { title: "Raw materials", desc: "Purchases debit raw materials, packaging, consumables, or spare parts inventory.", icon: PackageOpen },
  { title: "WIP", desc: "Material issues, labour, and allocated overhead accumulate in work in progress.", icon: Route },
  { title: "Finished goods", desc: "Completed production transfers batch cost from WIP to finished goods.", icon: PackageCheck },
  { title: "COGS", desc: "Sales recognize product revenue and move finished goods cost to COGS.", icon: Gauge },
] as const;

const setupCards = [
  { title: "Journal mappings", page: "admin", desc: "Finished goods, WIP, raw materials, wages payable, overhead, scrap, and consumables." },
  { title: "Chart of accounts", page: "gl_accounts", desc: "Inventory, factory overhead, manufacturing income, COGS, fixed assets, liabilities, and equity." },
  { title: "Cost centres", page: "accounting_cost_allocation", desc: "Factory, warehouse, maintenance, machine, production line, sales, and administration." },
] as const;

export function ManufacturingPage({ onNavigate, readOnly = false }: Props) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!user?.isSuperAdmin;
  const [snapshot, setSnapshot] = useState({ openOrders: 0, releasedOrders: 0, todayOutput: 0, unreservedMaterials: 0, plannedMinutes: 0, actualMinutes: 0, overdueOrders: 0 });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [ordersRes, entriesRes, reservationsRes, cardsRes] = await Promise.all([
        filterByOrganizationId(supabase.from("manufacturing_work_orders").select("status,due_date"), orgId, superAdmin),
        filterByOrganizationId(supabase.from("manufacturing_production_entries").select("produced_qty").eq("production_date", today), orgId, superAdmin),
        filterByOrganizationId(supabase.from("manufacturing_material_reservations").select("status"), orgId, superAdmin),
        filterByOrganizationId(supabase.from("manufacturing_job_cards").select("planned_minutes,actual_minutes"), orgId, superAdmin),
      ]);
      if (cancelled) return;
      const orders = (ordersRes.data || []) as Array<{ status: string | null; due_date: string | null }>;
      const entries = (entriesRes.data || []) as Array<{ produced_qty: number | null }>;
      const reservations = (reservationsRes.data || []) as Array<{ status: string | null }>;
      const cards = (cardsRes.data || []) as Array<{ planned_minutes: number | null; actual_minutes: number | null }>;
      setSnapshot({
        openOrders: orders.filter((order) => order.status !== "Completed" && order.status !== "Cancelled").length,
        releasedOrders: orders.filter((order) => order.status === "In Progress").length,
        todayOutput: entries.reduce((sum, entry) => sum + Number(entry.produced_qty || 0), 0),
        unreservedMaterials: reservations.filter((reservation) => reservation.status === "planned").length,
        plannedMinutes: cards.reduce((sum, card) => sum + Number(card.planned_minutes || 0), 0),
        actualMinutes: cards.reduce((sum, card) => sum + Number(card.actual_minutes || 0), 0),
        overdueOrders: orders.filter((order) => order.status !== "Completed" && order.status !== "Cancelled" && !!order.due_date && order.due_date < today).length,
      });
    })();
    return () => { cancelled = true; };
  }, [orgId, superAdmin]);

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      {readOnly && <ReadOnlyNotice />}
      <div className="flex items-center gap-3">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
          <Factory className="w-6 h-6" aria-hidden />
        </span>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Manufacturing</h1>
          <p className="text-sm text-slate-600">Production accounting from raw materials through WIP, finished goods, sales, and COGS.</p>
        </div>
      </div>

      <section>
        <h2 className="text-sm font-semibold text-slate-800 mb-3">Today’s factory snapshot</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <button type="button" onClick={() => onNavigate?.("manufacturing_work_orders")} className="rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm hover:bg-slate-50"><p className="text-2xl font-bold text-slate-900">{snapshot.openOrders}</p><p className="mt-1 text-xs text-slate-600">Open production orders</p></button>
          <button type="button" onClick={() => onNavigate?.("manufacturing_work_orders")} className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-left shadow-sm hover:bg-blue-100"><p className="text-2xl font-bold text-blue-900">{snapshot.releasedOrders}</p><p className="mt-1 text-xs text-blue-800">Orders in progress</p></button>
          <button type="button" onClick={() => onNavigate?.("manufacturing_production_entries")} className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-left shadow-sm hover:bg-emerald-100"><p className="text-2xl font-bold text-emerald-900">{snapshot.todayOutput.toFixed(3)}</p><p className="mt-1 text-xs text-emerald-800">Units produced today</p></button>
          <button type="button" onClick={() => onNavigate?.("manufacturing_work_orders")} className={`rounded-lg border p-4 text-left shadow-sm ${snapshot.unreservedMaterials ? "border-amber-200 bg-amber-50 hover:bg-amber-100" : "border-slate-200 bg-white hover:bg-slate-50"}`}><p className={`text-2xl font-bold ${snapshot.unreservedMaterials ? "text-amber-900" : "text-slate-900"}`}>{snapshot.unreservedMaterials}</p><p className={`mt-1 text-xs ${snapshot.unreservedMaterials ? "text-amber-800" : "text-slate-600"}`}>Materials awaiting reservation</p></button>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-800">Production performance</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3 text-sm"><div><span className="block text-slate-500">Planned job-card time</span><strong>{snapshot.plannedMinutes.toFixed(0)} min</strong></div><div><span className="block text-slate-500">Actual recorded time</span><strong className={snapshot.actualMinutes > snapshot.plannedMinutes ? "text-amber-700" : "text-emerald-700"}>{snapshot.actualMinutes.toFixed(0)} min</strong><span className="ml-2 text-xs text-slate-500">({(snapshot.actualMinutes - snapshot.plannedMinutes).toFixed(0)} variance)</span></div><button type="button" onClick={() => onNavigate?.("manufacturing_work_orders")} className="text-left"><span className="block text-slate-500">Overdue production orders</span><strong className={snapshot.overdueOrders ? "text-rose-700" : "text-emerald-700"}>{snapshot.overdueOrders}</strong></button></div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-800 mb-3">Accounting flow</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {accountingFlow.map((step) => {
            const Icon = step.icon;
            return (
              <div key={step.title} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-emerald-700" aria-hidden />
                  <h3 className="text-sm font-semibold text-slate-900">{step.title}</h3>
                </div>
                <p className="mt-2 text-sm leading-5 text-slate-600">{step.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-800 mb-3">Setup</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {setupCards.map((card) => (
            <button
              key={card.title}
              type="button"
              onClick={() => onNavigate?.(card.page)}
              className="flex min-h-28 flex-col justify-between rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-slate-300 hover:bg-slate-50/80"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-900">{card.title}</span>
                <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              </span>
              <span className="mt-2 text-sm leading-5 text-slate-600">{card.desc}</span>
            </button>
          ))}
        </div>
      </section>

      <div>
        <h2 className="text-sm font-semibold text-slate-800 mb-3">Reports</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          {reportCards.map((card) => {
            const Icon = card.icon;
            return (
              <button
                key={card.page}
                type="button"
                onClick={() =>
                  onNavigate?.(card.page, "state" in card ? (card.state as Record<string, unknown>) : undefined)
                }
                className="text-left rounded-lg border border-slate-200 bg-white p-5 shadow-sm hover:border-slate-300 hover:bg-slate-50/80 transition flex flex-col gap-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 font-semibold text-slate-900">
                    <Icon className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden />
                    {card.title}
                  </span>
                  <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
                </div>
                <p className="text-sm text-slate-600">{card.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-800 mb-3">Counter sales</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          {salesCards.map((card) => {
            const Icon = card.icon;
            return (
              <button
                key={card.page}
                type="button"
                onClick={() => onNavigate?.(card.page)}
                className="text-left rounded-lg border border-slate-200 bg-white p-5 shadow-sm hover:border-slate-300 hover:bg-slate-50/80 transition flex flex-col gap-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 font-semibold text-slate-900">
                    <Icon className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden />
                    {card.title}
                  </span>
                  <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
                </div>
                <p className="text-sm text-slate-600">{card.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      <h2 className="text-sm font-semibold text-slate-800 mb-3">Production</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {starterCards.map((card) => (
          <button
            key={card.page}
            type="button"
            onClick={() => onNavigate?.(card.page)}
            className="text-left rounded-lg border border-slate-200 bg-white p-5 shadow-sm hover:border-slate-300 hover:bg-slate-50/80 transition flex flex-col gap-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-900">{card.title}</span>
              <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
            </div>
            <p className="text-sm text-slate-600">{card.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
