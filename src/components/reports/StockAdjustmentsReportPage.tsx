import { useEffect, useMemo, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { downloadCsv } from "../../lib/accountingReportExport";
import { filterByOrganizationId, filterStockMovementsByOrganizationId } from "../../lib/supabaseOrgFilter";
import { supabase } from "../../lib/supabase";
import { ensureActiveOrganization } from "../../lib/stockBulkImport";
import { computeRangeInTimezone, toBusinessDateString, type DateRangeKey } from "../../lib/timezone";
import { effectiveStockMovementInOut } from "../../lib/stockMovementEffective";
import { PageNotes } from "../common/PageNotes";

type ProductRow = {
  id: string;
  name: string;
  department_id: string | null;
  cost_price: number | null;
};

type DepartmentRow = {
  id: string;
  name: string;
};

type MovementRow = {
  id?: string;
  product_id: string;
  movement_date: string | null;
  created_at: string | null;
  created_by_staff_id: string | null;
  source_id: string | null;
  quantity_in: number | null;
  quantity_out: number | null;
  unit_cost: number | null;
  note: string | null;
};

type ReportRow = {
  id: string;
  date: string;
  postedAt: string;
  sourceId: string;
  productName: string;
  departmentId: string | null;
  departmentName: string;
  reason: string;
  quantityIn: number;
  quantityOut: number;
  netQuantity: number;
  unitCost: number;
  valueImpact: number;
  createdByName: string;
};

const dateRangeOptions: Array<{ value: DateRangeKey; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this_week", label: "This week" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "this_year", label: "This year" },
  { value: "custom", label: "Custom" },
];

function adjustmentReasonFromNote(note: string | null): string {
  return String(note || "Manual adjustment")
    .replace(/^GL .*?\| /, "")
    .replace(/\s*\[CLOSING_STOCK:[^\]]+\]\s*$/, "")
    .trim();
}

function numberCell(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pageHref(page: string, params?: Record<string, string>) {
  if (typeof window === "undefined") return `?page=${encodeURIComponent(page)}`;
  const url = new URL(window.location.href);
  url.searchParams.set("page", page);
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  return `${url.pathname}?${url.searchParams.toString()}${url.hash || ""}`;
}

export function StockAdjustmentsReportPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!user?.isSuperAdmin;

  const [dateRange, setDateRange] = useState<DateRangeKey>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { from, to } = useMemo(
    () => computeRangeInTimezone(dateRange, customFrom, customTo),
    [dateRange, customFrom, customTo]
  );

  const filteredRows = useMemo(() => {
    return rows.filter((row) => !selectedDepartmentId || row.departmentId === selectedDepartmentId);
  }, [rows, selectedDepartmentId]);

  const totals = useMemo(
    () =>
      filteredRows.reduce(
        (acc, row) => {
          acc.in += row.quantityIn;
          acc.out += row.quantityOut;
          acc.net += row.netQuantity;
          acc.value += row.valueImpact;
          return acc;
        },
        { in: 0, out: 0, net: 0, value: 0 }
      ),
    [filteredRows]
  );

  const departmentSummary = useMemo(() => {
    const summary = new Map<string, { department: string; lines: number; net: number; value: number }>();
    filteredRows.forEach((row) => {
      const key = row.departmentId || "none";
      const current = summary.get(key) || { department: row.departmentName, lines: 0, net: 0, value: 0 };
      current.lines += 1;
      current.net += row.netQuantity;
      current.value += row.valueImpact;
      summary.set(key, current);
    });
    return Array.from(summary.values()).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  }, [filteredRows]);

  const loadReport = async () => {
    setLoading(true);
    setError(null);
    try {
      if (orgId) await ensureActiveOrganization(orgId);

      const [productsRes, departmentsRes, movementsRes] = await Promise.all([
        filterByOrganizationId(
          supabase.from("products").select("id, name, department_id, cost_price").order("name"),
          orgId,
          superAdmin
        ),
        filterByOrganizationId(supabase.from("departments").select("id, name").order("name"), orgId, superAdmin),
        filterStockMovementsByOrganizationId(
          supabase
            .from("product_stock_movements")
            .select("id,product_id,movement_date,created_at,created_by_staff_id,source_id,quantity_in,quantity_out,unit_cost,note")
            .eq("source_type", "adjustment")
            .order("movement_date", { ascending: false }),
          orgId
        ),
      ]);

      if (productsRes.error) throw productsRes.error;
      if (departmentsRes.error) throw departmentsRes.error;
      if (movementsRes.error) throw movementsRes.error;

      const products = (productsRes.data || []) as ProductRow[];
      const deptRows = (departmentsRes.data || []) as DepartmentRow[];
      const movements = (movementsRes.data || []) as MovementRow[];
      const staffIds = Array.from(new Set(movements.map((m) => m.created_by_staff_id).filter(Boolean) as string[]));
      const staffNameById = new Map<string, string>();

      if (staffIds.length > 0) {
        const staffRes = await filterByOrganizationId(
          supabase.from("staff").select("id, full_name").in("id", staffIds),
          orgId,
          superAdmin
        );
        if (staffRes.error) throw staffRes.error;
        (staffRes.data || []).forEach((staff: { id: string; full_name: string | null }) => {
          staffNameById.set(staff.id, staff.full_name || "Unknown");
        });
      }

      const productById = new Map(products.map((p) => [p.id, p]));
      const deptById = new Map(deptRows.map((d) => [d.id, d.name]));
      setDepartments(deptRows);

      const result = movements
        .map((movement) => {
          const dt = new Date(movement.movement_date || movement.created_at || "");
          if (!Number.isFinite(dt.getTime()) || dt < from || dt >= to) return null;

          const product = productById.get(movement.product_id);
          const { inQty, outQty } = effectiveStockMovementInOut(movement);
          const unitCost = Number(movement.unit_cost ?? product?.cost_price ?? 0) || 0;
          const netQuantity = inQty - outQty;
          const departmentId = product?.department_id ?? null;

          return {
            id: movement.id || `${movement.source_id || movement.product_id}-${movement.movement_date || movement.created_at}`,
            date: toBusinessDateString(movement.movement_date || movement.created_at || new Date()),
            postedAt: movement.created_at ? new Date(movement.created_at).toLocaleString() : "",
            sourceId: movement.source_id || "",
            productName: product?.name || "Unknown item",
            departmentId,
            departmentName: departmentId ? deptById.get(departmentId) || "Unassigned" : "Unassigned",
            reason: adjustmentReasonFromNote(movement.note),
            quantityIn: inQty,
            quantityOut: outQty,
            netQuantity,
            unitCost,
            valueImpact: netQuantity * unitCost,
            createdByName: movement.created_by_staff_id
              ? staffNameById.get(movement.created_by_staff_id) || "Unknown"
              : "System",
          } satisfies ReportRow;
        })
        .filter((row): row is ReportRow => Boolean(row))
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || a.productName.localeCompare(b.productName));

      setRows(result);
    } catch (e) {
      console.error("[Stock adjustments report] load failed:", e);
      setError(e instanceof Error ? e.message : "Could not load stock adjustments report.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReport();
  }, [dateRange, customFrom, customTo, orgId, superAdmin]);

  const exportCsv = () => {
    downloadCsv("stock_adjustments_report.csv", [
      ["Date", "Department", "Item", "Reason", "Qty in", "Qty out", "Net qty", "Unit cost", "Value impact", "Posted by", "Source ID"],
      ...filteredRows.map((row) => [
        row.date,
        row.departmentName,
        row.productName,
        row.reason,
        numberCell(row.quantityIn),
        numberCell(row.quantityOut),
        numberCell(row.netQuantity),
        numberCell(row.unitCost),
        numberCell(row.valueImpact),
        row.createdByName,
        row.sourceId,
      ]),
    ]);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold text-slate-900">Stock adjustments report</h2>
            <PageNotes ariaLabel="Stock adjustments report help">
              <p>Review manual and imported stock adjustments by department and date range.</p>
            </PageNotes>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Showing adjustments from {toBusinessDateString(from)} to {toBusinessDateString(new Date(to.getTime() - 1))}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="app-btn-secondary" onClick={() => void loadReport()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button type="button" className="app-btn-secondary" onClick={exportCsv} disabled={filteredRows.length === 0}>
            <Download className="h-4 w-4" /> CSV
          </button>
        </div>
      </div>

      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-4">
        <label className="text-sm font-medium text-slate-700">
          Date
          <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={dateRange} onChange={(e) => setDateRange(e.target.value as DateRangeKey)}>
            {dateRangeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-700">
          From
          <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} disabled={dateRange !== "custom"} />
        </label>
        <label className="text-sm font-medium text-slate-700">
          To
          <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} disabled={dateRange !== "custom"} />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Department
          <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={selectedDepartmentId} onChange={(e) => setSelectedDepartmentId(e.target.value)}>
            <option value="">All departments</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase text-slate-500">Lines</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{filteredRows.length.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase text-slate-500">Qty in</p>
          <p className="mt-1 text-2xl font-bold text-emerald-700">{numberCell(totals.in)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase text-slate-500">Qty out</p>
          <p className="mt-1 text-2xl font-bold text-rose-700">{numberCell(totals.out)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase text-slate-500">Value impact</p>
          <p className={`mt-1 text-2xl font-bold ${totals.value < 0 ? "text-rose-700" : "text-slate-900"}`}>{numberCell(totals.value)}</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-[1000px] w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Department</th>
                <th className="px-3 py-2 text-left">Item</th>
                <th className="px-3 py-2 text-left">Reason</th>
                <th className="px-3 py-2 text-right">In</th>
                <th className="px-3 py-2 text-right">Out</th>
                <th className="px-3 py-2 text-right">Net</th>
                <th className="px-3 py-2 text-right">Unit cost</th>
                <th className="px-3 py-2 text-right">Value</th>
                <th className="px-3 py-2 text-left">Posted by</th>
                <th className="px-3 py-2 text-left">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={11}>
                    Loading adjustments...
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={11}>
                    No stock adjustments match these filters.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-700">{row.date}</td>
                    <td className="px-3 py-2 text-slate-700">{row.departmentName}</td>
                    <td className="px-3 py-2 font-medium text-slate-900">{row.productName}</td>
                    <td className="px-3 py-2 text-slate-700">{row.reason}</td>
                    <td className="px-3 py-2 text-right text-emerald-700">{numberCell(row.quantityIn)}</td>
                    <td className="px-3 py-2 text-right text-rose-700">{numberCell(row.quantityOut)}</td>
                    <td className="px-3 py-2 text-right text-slate-700">{numberCell(row.netQuantity)}</td>
                    <td className="px-3 py-2 text-right text-slate-700">{numberCell(row.unitCost)}</td>
                    <td className={`px-3 py-2 text-right font-medium ${row.valueImpact < 0 ? "text-rose-700" : "text-slate-900"}`}>{numberCell(row.valueImpact)}</td>
                    <td className="px-3 py-2 text-slate-700">{row.createdByName}</td>
                    <td className="px-3 py-2">
                      {row.sourceId ? (
                        <a className="font-medium text-brand-700 hover:underline" href={pageHref("inventory_stock_adjustments", { highlightAdjustmentSourceId: row.sourceId })}>
                          Open
                        </a>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">Department summary</h3>
          <div className="mt-3 space-y-3">
            {departmentSummary.length === 0 ? (
              <p className="text-sm text-slate-500">No departments in this report.</p>
            ) : (
              departmentSummary.map((item) => (
                <div key={item.department} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-slate-900">{item.department}</p>
                    <p className="text-xs text-slate-500">{item.lines.toLocaleString()} lines</p>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3 text-sm">
                    <span className="text-slate-500">Net qty {numberCell(item.net)}</span>
                    <span className={item.value < 0 ? "font-semibold text-rose-700" : "font-semibold text-slate-900"}>{numberCell(item.value)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
