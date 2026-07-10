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
import { ReadOnlyNotice } from "../common/ReadOnlyNotice";

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
    title: "Manufacturing account",
    desc: "Calculate cost of goods manufactured from materials, labour, overhead, and WIP.",
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
