import { Calendar, ChevronDown, ChevronUp, Filter, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import type { DateRangeKey } from "@/lib/timezone";

const DATE_RANGE_OPTIONS: { value: DateRangeKey; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "this_week", label: "This week" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "custom", label: "Custom range" },
];

const fieldClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 hover:border-slate-300";

const labelClass = "mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500";

export type ItemReportFiltersPanelProps = {
  dateRange: DateRangeKey;
  onDateRangeChange: (value: DateRangeKey) => void;
  customFrom: string;
  customTo: string;
  onCustomFromChange: (value: string) => void;
  onCustomToChange: (value: string) => void;
  departmentFilter: string;
  onDepartmentFilterChange: (value: string) => void;
  departments: string[];
  customerFilter: string;
  onCustomerFilterChange: (value: string) => void;
  customers: string[];
  customerDisabled?: boolean;
  customerDisabledHint?: string;
  vendorFilter: string;
  onVendorFilterChange: (value: string) => void;
  vendors: string[];
  vendorDisabled?: boolean;
  vendorDisabledHint?: string;
  itemFilters: string[];
  onItemFiltersChange: (items: string[]) => void;
  items: string[];
  compact?: boolean;
  hideCustomer?: boolean;
};

function countActiveFilters(props: ItemReportFiltersPanelProps): number {
  let n = 0;
  if (props.dateRange !== "this_month") n += 1;
  if (props.departmentFilter !== "all") n += 1;
  if (props.customerFilter !== "all") n += 1;
  if (props.vendorFilter !== "all") n += 1;
  if (props.itemFilters.length > 0) n += 1;
  return n;
}

export function ItemReportFiltersPanel(props: ItemReportFiltersPanelProps) {
  const {
    dateRange,
    onDateRangeChange,
    customFrom,
    customTo,
    onCustomFromChange,
    onCustomToChange,
    departmentFilter,
    onDepartmentFilterChange,
    departments,
    customerFilter,
    onCustomerFilterChange,
    customers,
    customerDisabled,
    customerDisabledHint = "Not applicable",
    vendorFilter,
    onVendorFilterChange,
    vendors,
    vendorDisabled,
    vendorDisabledHint = "Not applicable",
    itemFilters,
    onItemFiltersChange,
    items,
    compact = false,
    hideCustomer = false,
  } = props;
  const [showItems, setShowItems] = useState(!compact);

  const activeCount = countActiveFilters(props);

  const clearAll = () => {
    onDateRangeChange("this_month");
    onCustomFromChange("");
    onCustomToChange("");
    onDepartmentFilterChange("all");
    onCustomerFilterChange("all");
    onVendorFilterChange("all");
    onItemFiltersChange([]);
  };

  const toggleItem = (name: string) => {
    if (itemFilters.includes(name)) {
      onItemFiltersChange(itemFilters.filter((x) => x !== name));
    } else {
      onItemFiltersChange([...itemFilters, name]);
    }
  };

  const selectAllItems = () => onItemFiltersChange([...items]);
  const clearItems = () => onItemFiltersChange([]);

  return (
    <div className={`mb-4 rounded-xl border border-slate-200/90 bg-white shadow-sm ${compact ? "p-3" : "p-4 md:p-5"}`}>
      <div className={`${compact ? "mb-3" : "mb-4 border-b border-slate-100 pb-3"} flex flex-wrap items-center justify-between gap-3`}>
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-700/10 text-brand-800">
            <Filter className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Filters</h2>
            {!compact ? <p className="text-xs text-slate-500">Narrow the report by period, department, and items</p> : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {activeCount > 0 ? (
            <span className="inline-flex items-center rounded-full bg-brand-700/10 px-2.5 py-0.5 text-xs font-semibold text-brand-900">
              {activeCount} active
            </span>
          ) : null}
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Reset
          </button>
        </div>
      </div>

      <div className={`grid grid-cols-1 sm:grid-cols-2 ${hideCustomer ? "lg:grid-cols-3" : "lg:grid-cols-4"} ${compact ? "gap-2" : "gap-4"}`}>
        <div>
          <label className={labelClass}>
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" aria-hidden />
              Period
            </span>
          </label>
          <select
            value={dateRange}
            onChange={(e) => onDateRangeChange(e.target.value as DateRangeKey)}
            className={fieldClass}
          >
            {DATE_RANGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {dateRange === "custom" ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => onCustomFromChange(e.target.value)}
                className={`${fieldClass} min-w-[10rem] flex-1`}
                aria-label="From date"
              />
              <span className="text-xs font-medium text-slate-400">to</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => onCustomToChange(e.target.value)}
                className={`${fieldClass} min-w-[10rem] flex-1`}
                aria-label="To date"
              />
            </div>
          ) : null}
        </div>

        <div>
          <label className={labelClass}>Department</label>
          <select value={departmentFilter} onChange={(e) => onDepartmentFilterChange(e.target.value)} className={fieldClass}>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d === "all" ? "All departments" : d}
              </option>
            ))}
          </select>
        </div>

        {!hideCustomer ? <div>
          <label className={labelClass}>Customer</label>
          <select
            value={customerFilter}
            onChange={(e) => onCustomerFilterChange(e.target.value)}
            className={`${fieldClass} ${customerDisabled ? "opacity-60" : ""}`}
            disabled={customerDisabled}
            title={customerDisabled ? customerDisabledHint : undefined}
          >
            {customers.map((c) => (
              <option key={c} value={c}>
                {c === "all" ? "All customers" : c}
              </option>
            ))}
            {customerDisabled ? <option value="none">{customerDisabledHint}</option> : null}
          </select>
        </div> : null}

        <div>
          <label className={labelClass}>Vendor</label>
          <select
            value={vendorFilter}
            onChange={(e) => onVendorFilterChange(e.target.value)}
            className={`${fieldClass} ${vendorDisabled ? "opacity-60" : ""}`}
            disabled={vendorDisabled}
            title={vendorDisabled ? vendorDisabledHint : undefined}
          >
            {vendors.map((v) => (
              <option key={v} value={v}>
                {v === "all" ? "All vendors" : v}
              </option>
            ))}
            {vendorDisabled ? <option value="none">{vendorDisabledHint}</option> : null}
          </select>
        </div>
      </div>

      <div className={compact ? "mt-3" : "mt-4"}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={() => setShowItems((value) => !value)} className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
            Items {itemFilters.length > 0 ? `(${itemFilters.length} selected)` : `(${items.length})`}
            {showItems ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={selectAllItems}
              disabled={items.length === 0}
              className="text-xs font-medium text-brand-700 hover:text-brand-900 disabled:opacity-40"
            >
              Select all
            </button>
            <span className="text-slate-300">|</span>
            <button
              type="button"
              onClick={clearItems}
              disabled={itemFilters.length === 0}
              className="text-xs font-medium text-slate-600 hover:text-slate-900 disabled:opacity-40"
            >
              Clear items
            </button>
          </div>
        </div>

        {itemFilters.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {itemFilters.map((name) => (
              <span
                key={name}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-brand-200 bg-brand-50 pl-2.5 pr-1 py-0.5 text-xs font-medium text-brand-900"
              >
                <span className="truncate">{name}</span>
                <button
                  type="button"
                  onClick={() => toggleItem(name)}
                  className="rounded-full p-0.5 hover:bg-brand-200/60"
                  aria-label={`Remove ${name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="mb-2 text-xs text-slate-500">All items included — pick specific lines below to filter.</p>
        )}

        {showItems ? <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white/80 p-2 shadow-inner">
          {items.length === 0 ? (
            <p className="px-2 py-3 text-center text-sm text-slate-500">No items in this period yet.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-0.5 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((name) => {
                const checked = itemFilters.includes(name);
                return (
                  <li key={name}>
                    <label
                      className={`flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-sm transition ${
                        checked ? "bg-brand-50 text-brand-950 ring-1 ring-brand-200/80" : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleItem(name)}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-700 focus:ring-brand-500/30"
                      />
                      <span className="leading-snug">{name}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div> : null}
      </div>
    </div>
  );
}
