import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { effectiveStockMovementInOut } from "../../lib/stockMovementEffective";
import { supabase } from "../../lib/supabase";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import { ensureActiveOrganization } from "../../lib/stockBulkImport";
import { fetchStockLedgerMovementsForProducts } from "../../lib/stockLedger";
import { businessDayRangeForDateString, businessTodayISO } from "../../lib/timezone";
import { downloadCsv, downloadXlsx, exportAccountingPdf } from "../../lib/accountingReportExport";
import { PageNotes } from "../common/PageNotes";

type ValuationMethod = "product_cost" | "last_purchase" | "weighted_average";

interface ProductRow {
  id: string;
  name: string;
  department_id: string | null;
  cost_price: number | null;
  sales_price: number | null;
  track_inventory?: boolean | null;
}

interface MovementRow {
  product_id: string;
  movement_date: string | null;
  quantity_in: number | null;
  quantity_out: number | null;
  unit_cost: number | null;
  source_type: string | null;
  note: string | null;
}

interface StockSummaryRow {
  product_id: string;
  product_name: string;
  department_id: string | null;
  department_name: string;
  qty_in: number;
  qty_out: number;
  on_hand: number;
  unit_cost: number;
  stock_value: number;
  sales_price: number;
  retail_value: number;
  margin_value: number;
  movement_count: number;
}

type ColumnKey = keyof StockSummaryRow;

const columnDefs: Array<{ key: ColumnKey; label: string; align?: "left" | "right"; required?: boolean }> = [
  { key: "department_name", label: "Department", align: "left" },
  { key: "product_name", label: "Item", align: "left", required: true },
  { key: "qty_in", label: "Total in", align: "right" },
  { key: "qty_out", label: "Total out", align: "right" },
  { key: "on_hand", label: "On hand", align: "right", required: true },
  { key: "unit_cost", label: "Unit cost", align: "right" },
  { key: "stock_value", label: "Stock value", align: "right", required: true },
  { key: "sales_price", label: "Sale price", align: "right" },
  { key: "retail_value", label: "Retail value", align: "right" },
  { key: "margin_value", label: "Potential margin", align: "right" },
  { key: "movement_count", label: "Movements", align: "right" },
];

const defaultColumns: ColumnKey[] = [
  "department_name",
  "product_name",
  "on_hand",
  "unit_cost",
  "stock_value",
  "sales_price",
  "retail_value",
];

const formatNumber = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function todayDateString() {
  return businessTodayISO();
}

function movementDate(raw: string | null): Date {
  const s = String(raw || "");
  const dayRange = businessDayRangeForDateString(s);
  if (dayRange) return dayRange.from;
  return new Date(s);
}

function valueForColumn(row: StockSummaryRow, key: ColumnKey) {
  if (key === "product_name" || key === "department_name") return row[key];
  if (key === "movement_count") return row[key].toLocaleString();
  return formatNumber(Number(row[key]) || 0);
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

export function StockSummaryReportPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!user?.isSuperAdmin;

  const [asAtDate, setAsAtDate] = useState(todayDateString());
  const [valuationMethod, setValuationMethod] = useState<ValuationMethod>("weighted_average");
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [showZeroStockItems, setShowZeroStockItems] = useState(true);
  const [selectedColumns, setSelectedColumns] = useState<ColumnKey[]>(defaultColumns);
  const [rows, setRows] = useState<StockSummaryRow[]>([]);
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadReport();
  }, [asAtDate, valuationMethod, orgId, superAdmin]);

  const loadReport = async () => {
    setLoading(true);
    setError(null);
    try {
      const effectiveAsAtDate = asAtDate || todayDateString();
      const asAtRange = businessDayRangeForDateString(effectiveAsAtDate);
      const asAtEnd = asAtRange?.to ?? new Date(`${effectiveAsAtDate}T23:59:59`);
      if (orgId) {
        await ensureActiveOrganization(orgId);
      }

      const [productsRes, departmentsRes] = await Promise.all([
        filterByOrganizationId(
          supabase.from("products").select("id, name, department_id, cost_price, sales_price, track_inventory").order("name"),
          orgId,
          superAdmin
        ),
        filterByOrganizationId(supabase.from("departments").select("id, name").order("name"), orgId, superAdmin),
      ]);

      if (productsRes.error) throw productsRes.error;
      if (departmentsRes.error) throw departmentsRes.error;

      const products = (productsRes.data || []) as ProductRow[];
      const ledgerMovements = await fetchStockLedgerMovementsForProducts(orgId, products.map((p) => p.id));
      const movements = (ledgerMovements as MovementRow[])
        .filter((m) => {
          const dt = movementDate(m.movement_date);
          return Number.isFinite(dt.getTime()) && dt < asAtEnd;
        })
        .sort((a, b) => movementDate(a.movement_date).getTime() - movementDate(b.movement_date).getTime());
      const deptRows = (departmentsRes.data || []) as Array<{ id: string; name: string }>;

      setDepartments(deptRows);

      const deptById = new Map(deptRows.map((d) => [d.id, d.name]));
      const productById = new Map(products.map((p) => [p.id, p]));
      const summaryByProduct = new Map<
        string,
        {
          qtyIn: number;
          qtyOut: number;
          lastCost: number;
          weightedCost: number;
          weightedQty: number;
          movementCount: number;
        }
      >();

      products.forEach((p) => {
        summaryByProduct.set(p.id, {
          qtyIn: 0,
          qtyOut: 0,
          lastCost: Number(p.cost_price ?? 0) || 0,
          weightedCost: 0,
          weightedQty: 0,
          movementCount: 0,
        });
      });

      movements.forEach((m) => {
        const product = productById.get(m.product_id);
        if (!product) return;

        const summary = summaryByProduct.get(m.product_id);
        if (!summary) return;

        const { inQty, outQty } = effectiveStockMovementInOut(m);
        const unitCost = Number(m.unit_cost ?? 0) || Number(product.cost_price ?? 0) || 0;

        summary.qtyIn += inQty;
        summary.qtyOut += outQty;
        summary.movementCount += 1;

        if (inQty > 0 && unitCost > 0) {
          summary.lastCost = unitCost;
          summary.weightedCost += inQty * unitCost;
          summary.weightedQty += inQty;
        }
      });

      const result = products
        .map((p) => {
          const summary = summaryByProduct.get(p.id);
          const qtyIn = summary?.qtyIn ?? 0;
          const qtyOut = summary?.qtyOut ?? 0;
          const onHand = qtyIn - qtyOut;
          const standardCost = Number(p.cost_price ?? 0) || 0;
          const weightedAverage =
            summary && summary.weightedQty > 0 ? summary.weightedCost / summary.weightedQty : standardCost;
          const unitCost =
            valuationMethod === "product_cost"
              ? standardCost
              : valuationMethod === "last_purchase"
                ? summary?.lastCost || standardCost
                : weightedAverage;
          const salesPrice = Number(p.sales_price ?? 0) || 0;
          const stockValue = onHand * unitCost;
          const retailValue = onHand * salesPrice;

          return {
            product_id: p.id,
            product_name: p.name,
            department_id: p.department_id,
            department_name: p.department_id ? deptById.get(p.department_id) || "Unassigned" : "Unassigned",
            qty_in: qtyIn,
            qty_out: qtyOut,
            on_hand: onHand,
            unit_cost: unitCost,
            stock_value: stockValue,
            sales_price: salesPrice,
            retail_value: retailValue,
            margin_value: retailValue - stockValue,
            movement_count: summary?.movementCount ?? 0,
          } satisfies StockSummaryRow;
        })
        .sort((a, b) => a.department_name.localeCompare(b.department_name) || a.product_name.localeCompare(b.product_name));

      setRows(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load stock summary.");
    } finally {
      setLoading(false);
    }
  };

  const visibleColumns = useMemo(
    () => columnDefs.filter((c) => c.required || selectedColumns.includes(c.key)),
    [selectedColumns]
  );

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        const q = itemSearch.trim().toLowerCase();
        if (q && !row.product_name.toLowerCase().includes(q)) return false;
        if (!showZeroStockItems && Math.abs(row.on_hand) < 0.000001) return false;
        if (!selectedDepartmentId) return true;
        if (selectedDepartmentId === "unassigned") return !row.department_id;
        return row.department_id === selectedDepartmentId;
      }),
    [rows, selectedDepartmentId, itemSearch, showZeroStockItems]
  );

  const totals = useMemo(
    () =>
      filteredRows.reduce(
        (acc, row) => ({
          qty_in: acc.qty_in + row.qty_in,
          qty_out: acc.qty_out + row.qty_out,
          on_hand: acc.on_hand + row.on_hand,
          stock_value: acc.stock_value + row.stock_value,
          retail_value: acc.retail_value + row.retail_value,
          margin_value: acc.margin_value + row.margin_value,
        }),
        { qty_in: 0, qty_out: 0, on_hand: 0, stock_value: 0, retail_value: 0, margin_value: 0 }
      ),
    [filteredRows]
  );

  const toggleColumn = (key: ColumnKey, checked: boolean) => {
    setSelectedColumns((prev) => {
      if (checked) return prev.includes(key) ? prev : [...prev, key];
      return prev.filter((c) => c !== key);
    });
  };

  const exportFileStamp = () => `stock-summary-${asAtDate || todayDateString()}`;

  const exportRows = (): (string | number)[][] => {
    const head = visibleColumns.map((c) => c.label);
    const body = filteredRows.map((row) => visibleColumns.map((c) => valueForColumn(row, c.key)));
    const total = visibleColumns.map((c) => {
      if (
        c.key === "qty_in" ||
        c.key === "qty_out" ||
        c.key === "on_hand" ||
        c.key === "stock_value" ||
        c.key === "retail_value" ||
        c.key === "margin_value"
      ) {
        return formatNumber(totals[c.key]);
      }
      return c.key === "product_name" ? "Total" : "";
    });
    return [
      ["Stock Summary", `As at ${asAtDate || todayDateString()}`],
      ["Valuation method", valuationMethod.replace(/_/g, " ")],
      ["Zero stock items", showZeroStockItems ? "Included" : "Hidden"],
      [],
      head,
      ...body,
      total,
    ];
  };

  const exportCsv = () => {
    downloadCsv(`${exportFileStamp()}.csv`, exportRows());
  };

  const exportExcel = () => {
    downloadXlsx(`${exportFileStamp()}.xlsx`, exportRows(), { sheetName: "Stock Summary" });
  };

  const exportPdf = () => {
    exportAccountingPdf({
      title: "Stock Summary",
      subtitle: `As at ${asAtDate || todayDateString()} · Valuation: ${valuationMethod.replace(/_/g, " ")} · Zero stock items: ${showZeroStockItems ? "included" : "hidden"}`,
      filename: `${exportFileStamp()}.pdf`,
      sections: [
        {
          title: "Items",
          head: visibleColumns.map((c) => c.label),
          body: [
            ...filteredRows.map((row) => visibleColumns.map((c) => valueForColumn(row, c.key))),
            visibleColumns.map((c) => {
              if (
                c.key === "qty_in" ||
                c.key === "qty_out" ||
                c.key === "on_hand" ||
                c.key === "stock_value" ||
                c.key === "retail_value" ||
                c.key === "margin_value"
              ) {
                return formatNumber(totals[c.key]);
              }
              return c.key === "product_name" ? "Total" : "";
            }),
          ],
        },
      ],
    });
  };

  const renderCell = (row: StockSummaryRow, key: ColumnKey) => {
    if (key === "product_name") {
      return (
        <a
          href={pageHref("Products", { editProductId: row.product_id })}
          className="font-medium text-blue-700 hover:text-blue-900 underline"
          title="Edit item details"
        >
          {row.product_name}
        </a>
      );
    }

    if (key === "on_hand") {
      return (
        <a
          href={pageHref("reports_stock_movement", { productId: row.product_id })}
          className="text-blue-700 hover:text-blue-900 underline"
          title="Open stock movement for this item"
        >
          {formatNumber(row.on_hand)}
        </a>
      );
    }

    return valueForColumn(row, key);
  };

  return (
    <div className="p-6 md:p-8">
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-bold text-slate-900">Stock Summary</h1>
              <PageNotes ariaLabel="Stock summary help">
                <p>
                  Shows inventory quantity and value as at the selected date. Weighted average uses inbound stock
                  movement costs up to the selected date; last purchase uses the most recent inbound unit cost.
                </p>
              </PageNotes>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              {filteredRows.length.toLocaleString()} item(s) - stock value {formatNumber(totals.stock_value)}
            </p>
          </div>
          <button
            type="button"
            onClick={loadReport}
            className="self-start px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 text-sm"
          >
            Refresh
          </button>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={exportExcel}
              disabled={loading || filteredRows.length === 0}
              className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 text-sm disabled:opacity-50"
            >
              Excel
            </button>
            <button
              type="button"
              onClick={exportCsv}
              disabled={loading || filteredRows.length === 0}
              className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 text-sm disabled:opacity-50"
            >
              CSV
            </button>
            <button
              type="button"
              onClick={exportPdf}
              disabled={loading || filteredRows.length === 0}
              className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 text-sm disabled:opacity-50"
            >
              PDF
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <label className="text-sm">
              <span className="block text-slate-600 mb-1">As at date</span>
              <input
                type="date"
                value={asAtDate}
                onChange={(e) => setAsAtDate(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="block text-slate-600 mb-1">Valuation method</span>
              <select
                value={valuationMethod}
                onChange={(e) => setValuationMethod(e.target.value as ValuationMethod)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2"
              >
                <option value="weighted_average">Weighted average</option>
                <option value="last_purchase">Last purchase cost</option>
                <option value="product_cost">Product cost price</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-slate-600 mb-1">Department</span>
              <select
                value={selectedDepartmentId}
                onChange={(e) => setSelectedDepartmentId(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2"
              >
                <option value="">All departments</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
                <option value="unassigned">Unassigned</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-slate-600 mb-1">Item search</span>
              <input
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                placeholder="Search item..."
                className="w-full border border-slate-300 rounded-lg px-3 py-2"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 md:pt-7">
              <input
                type="checkbox"
                checked={showZeroStockItems}
                onChange={(e) => setShowZeroStockItems(e.target.checked)}
              />
              Show zero stock on hand
            </label>
          </div>
          <div className="mt-4 border-t border-slate-200 pt-4">
            <div className="text-sm font-medium text-slate-700 mb-2">Report columns</div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {columnDefs.map((c) => (
                <label key={c.key} className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={c.required || selectedColumns.includes(c.key)}
                    disabled={c.required}
                    onChange={(e) => toggleColumn(c.key, e.target.checked)}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : loading ? (
        <p className="text-sm text-slate-500">Loading stock summary...</p>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[920px]">
            <thead className="bg-slate-50">
              <tr>
                {visibleColumns.map((c) => (
                  <th key={c.key} className={`p-3 ${c.align === "right" ? "text-right" : "text-left"}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.product_id} className="border-t">
                  {visibleColumns.map((c) => (
                    <td key={c.key} className={`p-3 ${c.align === "right" ? "text-right tabular-nums" : "text-left"}`}>
                      {renderCell(row, c.key)}
                    </td>
                  ))}
                </tr>
              ))}
              {filteredRows.length > 0 && (
                <tr className="border-t bg-slate-50 font-semibold">
                  {visibleColumns.map((c) => {
                    const totalValue =
                      c.key === "qty_in" ||
                      c.key === "qty_out" ||
                      c.key === "on_hand" ||
                      c.key === "stock_value" ||
                      c.key === "retail_value" ||
                      c.key === "margin_value"
                        ? formatNumber(totals[c.key])
                        : c.key === "product_name"
                          ? "Total"
                          : "";
                    return (
                      <td key={c.key} className={`p-3 ${c.align === "right" ? "text-right tabular-nums" : "text-left"}`}>
                        {totalValue}
                      </td>
                    );
                  })}
                </tr>
              )}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={visibleColumns.length} className="p-6 text-center text-slate-500">
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
