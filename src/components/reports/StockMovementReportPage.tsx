import { useEffect, useMemo, useState } from "react";
import { Columns3, SlidersHorizontal, X } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { computeRangeInTimezone, businessDayRangeForDateString, toBusinessDateString, type DateRangeKey } from "../../lib/timezone";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import { fetchStockLedgerMovementsForProducts } from "../../lib/stockLedger";
import { effectiveStockMovementInOut } from "../../lib/stockMovementEffective";
import { PageNotes } from "../common/PageNotes";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

interface Row {
  product_id: string;
  product_name: string;
  location: string;
  openingQty: number;
  /** All stock added through an external purchase or completed production in the period. */
  receivedQty: number;
  /** Stock received from suppliers / GRNs in the period. */
  purchasedQty: number;
  /** Finished goods received from completed production in the period. */
  producedQty: number;
  /** opening + received */
  totalOsRec: number;
  /** Sale movements (POS etc.) in period. */
  salesQty: number;
  /** sales_qty × product sales_price (list); excludes discounts. */
  salesAmount: number;
  /** Net adjustment qty in period (adjustment outs − ins; positive = net stock lost). */
  rejectsQty: number;
  closingQty: number;
  receivedSourcePage?: string | null;
  receivedSourceId?: string | null;
  salesSourcePage?: string | null;
  salesSourceId?: string | null;
  rejectsSourcePage?: string | null;
  rejectsSourceId?: string | null;
  receivedHasMixedSources?: boolean;
  salesHasMixedSources?: boolean;
  rejectsHasMixedSources?: boolean;
}

interface DailyRow {
  date: string;
  product_id: string;
  location: string;
  openingQty: number;
  purchasesQty: number;
  producedQty: number;
  salesQty: number;
  /** Adjustment outs minus ins; positive means stock was reduced. */
  adjustmentsQty: number;
  /** Net transfers and other movements not classified above. */
  otherNetQty: number;
  closingQty: number;
}

type MovementColumnKey = "location" | "product" | "opening" | "purchases" | "produced" | "stockIn" | "available" | "sales" | "salesAmount" | "adjustments" | "closing";
type MovementColumn = { key: MovementColumnKey; label: string; numeric?: boolean; width: number };

const MOVEMENT_COLUMNS: MovementColumn[] = [
  { key: "location", label: "Location", width: 22 },
  { key: "product", label: "Product", width: 40 },
  { key: "opening", label: "Opening stock", numeric: true, width: 18 },
  { key: "purchases", label: "External purchases", numeric: true, width: 18 },
  { key: "produced", label: "Produced", numeric: true, width: 16 },
  { key: "stockIn", label: "Total stock in", numeric: true, width: 18 },
  { key: "available", label: "Total available", numeric: true, width: 20 },
  { key: "sales", label: "Sales", numeric: true, width: 16 },
  { key: "salesAmount", label: "Sales amount", numeric: true, width: 20 },
  { key: "adjustments", label: "Adjustments", numeric: true, width: 18 },
  { key: "closing", label: "Closing stock", numeric: true, width: 18 },
];

const initialVisibleColumns = Object.fromEntries(MOVEMENT_COLUMNS.map((column) => [column.key, true])) as Record<MovementColumnKey, boolean>;

function matchesColumnFilter(value: string | number, rawFilter: string, numeric = false) {
  const filter = rawFilter.trim();
  if (!filter) return true;
  if (numeric) {
    const match = /^(>=|<=|>|<|=)?\s*(-?\d+(?:\.\d+)?)$/.exec(filter);
    if (match) {
      const actual = Number(value);
      const target = Number(match[2]);
      switch (match[1] || "=") {
        case ">": return actual > target;
        case ">=": return actual >= target;
        case "<": return actual < target;
        case "<=": return actual <= target;
        default: return Math.abs(actual - target) < 0.0001;
      }
    }
  }
  return String(value).toLocaleLowerCase().includes(filter.toLocaleLowerCase());
}

function initialProductIdFromUrl(): string {
  if (typeof window === "undefined") return "";
  const qp = new URLSearchParams(window.location.search);
  return qp.get("productId") || qp.get("selectedProductId") || "";
}

export function StockMovementReportPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!user?.isSuperAdmin;

  const [dateRange, setDateRange] = useState<DateRangeKey>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [dailyRows, setDailyRows] = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLocation, setSelectedLocation] = useState<string>("");
  const [selectedProductId, setSelectedProductId] = useState<string>(() => initialProductIdFromUrl());
  const [productsList, setProductsList] = useState<{ id: string; name: string }[]>([]);
  const [columnFilters, setColumnFilters] = useState<Partial<Record<MovementColumnKey, string>>>({});
  const [visibleColumns, setVisibleColumns] = useState<Record<MovementColumnKey, boolean>>(initialVisibleColumns);
  const [showColumnPicker, setShowColumnPicker] = useState(false);

  const sourceTypeToPage = (sourceType: string | null | undefined): string | null => {
    const st = String(sourceType || "").toLowerCase();
    if (!st) return null;
    if (["bill", "grn", "purchase", "vendor_bill", "vendor_payment"].includes(st)) return "purchases_bills";
    if (st === "manufacturing_production") return "manufacturing_production_entries";
    if (st === "sale") return "transactions";
    if (st === "transfer") return "inventory_store_requisitions";
    if (st === "adjustment") return "inventory_stock_adjustments";
    return null;
  };

  const pageHref = (page: string, params?: Record<string, string>) => {
    if (typeof window === "undefined") return `?page=${encodeURIComponent(page)}`;
    const url = new URL(window.location.href);
    url.searchParams.set("page", page);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v) url.searchParams.set(k, v);
      });
    }
    // Use relative app URL so links work in both dev/prod hosts and new tabs.
    return `${url.pathname}?${url.searchParams.toString()}${url.hash || ""}`;
  };

  useEffect(() => {
    loadReport();
  }, [dateRange, customFrom, customTo, orgId, superAdmin]);

  const loadReport = async () => {
    setLoading(true);
    const { from, to } = computeRangeInTimezone(dateRange, customFrom, customTo);

    const [productsResult, billsResult] = await Promise.all([
      filterByOrganizationId(
        supabase.from("products").select("id, name, department_id, cost_price, sales_price"),
        orgId,
        superAdmin
      ),
      filterByOrganizationId(
        supabase.from("bills").select("id,bill_date"),
        orgId,
        superAdmin
      ),
    ]);
    const products = productsResult.data || [];
    const billDateById = new Map(
      ((billsResult.data || []) as Array<{ id: string; bill_date: string | null }>)
        .filter((bill) => !!bill.bill_date)
        .map((bill) => [bill.id, String(bill.bill_date)])
    );
    const moves = await fetchStockLedgerMovementsForProducts(
      orgId,
      ((products || []) as Array<{ id: string }>).map((p) => p.id)
    );

    const byKey = new Map<
      string,
      {
        product_id: string;
        location: string;
        openingQty: number;
        periodInQty: number;
        periodOutQty: number;
        receivedQty: number;
        purchasedQty: number;
        producedQty: number;
        salesQty: number;
        salesAmount: number;
        rejectsQty: number;
        receivedSourceTypes: Set<string>;
        salesSourceTypes: Set<string>;
        rejectsSourceTypes: Set<string>;
        receivedSourceIds: Set<string>;
        salesSourceIds: Set<string>;
        rejectsSourceIds: Set<string>;
        receivedSourcePageCandidate: string | null;
        salesSourcePageCandidate: string | null;
        rejectsSourcePageCandidate: string | null;
        receivedSourceIdCandidate: string | null;
        salesSourceIdCandidate: string | null;
        rejectsSourceIdCandidate: string | null;
      }
    >();

    const allMoves = ((moves || []) as any[]).slice();

    const isPurchaseMovement = (m: any): boolean => {
      const st = String(m.source_type || "").toLowerCase();
      const note = String(m.note || "").toLowerCase();
      return (
        ["bill", "grn", "purchase", "vendor_bill", "vendor_payment"].includes(st) ||
        note.includes("grn") ||
        note.includes("purchase")
      );
    };
    const isProductionReceipt = (m: any): boolean =>
      String(m.source_type || "").toLowerCase() === "manufacturing_production";

    // Pre-fill missing unit_cost using last known cost or product cost_price
    const costPriceByProduct = new Map<string, number>();
    const salesPriceByProduct = new Map<string, number>();
    (products || []).forEach((p: any) => {
      if (p.cost_price != null) {
        costPriceByProduct.set(p.id, Number(p.cost_price) || 0);
      }
      if (p.sales_price != null) {
        salesPriceByProduct.set(p.id, Number(p.sales_price) || 0);
      }
    });

    // Sort all moves globally by date so lastCost per product/location flows correctly over time
    allMoves.sort(
      (a, b) =>
        new Date(a.movement_date).getTime() - new Date(b.movement_date).getTime()
    );

    const lastCostByKey = new Map<string, number>();
    allMoves.forEach((m) => {
      const pid = m.product_id as string;
      const loc = (m.location as string) || "default";
      const key = `${pid}::${loc}`;
      const { inQty: qiEff } = effectiveStockMovementInOut(m);
      let uc = m.unit_cost != null ? Number(m.unit_cost) || 0 : 0;

      if (qiEff > 0) {
        if (!uc) {
          // try last known cost for this product+location
          const last = lastCostByKey.get(key);
          if (last != null && last > 0) {
            uc = last;
          } else {
            // fallback to product cost_price
            uc = costPriceByProduct.get(pid) || 0;
          }
          m.unit_cost = uc;
        }
        if (uc > 0) {
          lastCostByKey.set(key, uc);
        }
      }
    });

    const movementDate = (movement: { movement_date?: unknown; source_type?: unknown; source_id?: unknown }): Date => {
      const sourceType = String(movement.source_type || "").toLowerCase();
      const sourceId = String(movement.source_id || "");
      // Legacy GRN receipts were timestamped on approval/reposting. Reports
      // should consistently show them on the supplier bill's transaction date.
      const s = sourceType === "bill" && sourceId
        ? billDateById.get(sourceId) || String(movement.movement_date || "")
        : String(movement.movement_date || "");
      const dayRange = businessDayRangeForDateString(s);
      if (dayRange) return dayRange.from;
      return new Date(s);
    };

    allMoves.forEach((m: any) => {
      const pid = m.product_id as string;
      const loc = (m.location as string) || "default";
      const key = `${pid}::${loc}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          product_id: pid,
          location: loc,
          openingQty: 0,
          periodInQty: 0,
          periodOutQty: 0,
          receivedQty: 0,
          purchasedQty: 0,
          producedQty: 0,
          salesQty: 0,
          salesAmount: 0,
          rejectsQty: 0,
          receivedSourceTypes: new Set<string>(),
          salesSourceTypes: new Set<string>(),
          rejectsSourceTypes: new Set<string>(),
          receivedSourceIds: new Set<string>(),
          salesSourceIds: new Set<string>(),
          rejectsSourceIds: new Set<string>(),
          receivedSourcePageCandidate: null,
          salesSourcePageCandidate: null,
          rejectsSourcePageCandidate: null,
          receivedSourceIdCandidate: null,
          salesSourceIdCandidate: null,
          rejectsSourceIdCandidate: null,
        });
      }
      const row = byKey.get(key)!;
      const mvDate = movementDate(m);
      if (mvDate >= to) {
        // Exclude future/out-of-range rows from current report slice entirely.
        return;
      }
      const { inQty: qiEff, outQty: qoEff } = effectiveStockMovementInOut(m);
      const qtyNet = qiEff - qoEff;

      if (mvDate < from) {
        row.openingQty += qtyNet;
      } else if (mvDate >= from && mvDate < to) {
        row.periodInQty += qiEff;
        row.periodOutQty += qoEff;

        const stLower = String(m.source_type || "").toLowerCase();

        if ((isPurchaseMovement(m) || isProductionReceipt(m)) && qiEff > 0) {
          row.receivedQty += qiEff;
          if (isPurchaseMovement(m)) row.purchasedQty += qiEff;
          if (isProductionReceipt(m)) row.producedQty += qiEff;
          const sourcePage = sourceTypeToPage(stLower);
          if (isPurchaseMovement(m)) row.receivedSourceTypes.add(stLower);
          if (isPurchaseMovement(m) && m.source_id) row.receivedSourceIds.add(String(m.source_id));
          if (isPurchaseMovement(m) && !row.receivedSourcePageCandidate && sourcePage) {
            row.receivedSourcePageCandidate = sourcePage;
            row.receivedSourceIdCandidate = m.source_id ? String(m.source_id) : null;
          }
        }

        if (stLower === "sale" && qoEff > 0) {
          row.salesQty += qoEff;
          const sp = salesPriceByProduct.get(pid) || 0;
          row.salesAmount += qoEff * sp;
          const sourcePage = sourceTypeToPage(stLower);
          row.salesSourceTypes.add(stLower);
          if (m.source_id) row.salesSourceIds.add(String(m.source_id));
          if (!row.salesSourcePageCandidate && sourcePage) {
            row.salesSourcePageCandidate = sourcePage;
            row.salesSourceIdCandidate = m.source_id ? String(m.source_id) : null;
          }
        }

        if (stLower === "adjustment") {
          row.rejectsQty += qoEff - qiEff;
          const sourcePage = sourceTypeToPage(stLower);
          row.rejectsSourceTypes.add(stLower);
          if (m.source_id) row.rejectsSourceIds.add(String(m.source_id));
          if (!row.rejectsSourcePageCandidate && sourcePage) {
            row.rejectsSourcePageCandidate = sourcePage;
            row.rejectsSourceIdCandidate = m.source_id ? String(m.source_id) : null;
          }
        }
      }
    });

    const nameById = new Map<string, string>();
    const productList: { id: string; name: string }[] = [];
    (products || []).forEach((p: any) => {
      nameById.set(p.id, p.name);
      productList.push({ id: p.id, name: p.name });
    });
    setProductsList(productList.sort((a, b) => a.name.localeCompare(b.name)));

    const result: Row[] = Array.from(byKey.values())
      .map((r) => {
        const closingQty = r.openingQty + r.periodInQty - r.periodOutQty;
        const totalOsRec = r.openingQty + r.receivedQty;

        return {
          product_id: r.product_id,
          product_name: nameById.get(r.product_id) || r.product_id,
          location: r.location,
          openingQty: r.openingQty,
          receivedQty: r.receivedQty,
          purchasedQty: r.purchasedQty,
          producedQty: r.producedQty,
          totalOsRec,
          salesQty: r.salesQty,
          salesAmount: r.salesAmount,
          rejectsQty: r.rejectsQty,
          closingQty,
          receivedSourcePage: r.receivedSourcePageCandidate,
          salesSourcePage: r.salesSourcePageCandidate,
          rejectsSourcePage: r.rejectsSourcePageCandidate,
          receivedSourceId: r.receivedSourceIdCandidate,
          salesSourceId: r.salesSourceIdCandidate,
          rejectsSourceId: r.rejectsSourceIdCandidate,
          receivedHasMixedSources: r.receivedSourceTypes.size > 1,
          salesHasMixedSources: r.salesSourceTypes.size > 1,
          rejectsHasMixedSources: r.rejectsSourceTypes.size > 1,
        };
      })
      .sort((a, b) => a.location.localeCompare(b.location) || a.product_name.localeCompare(b.product_name));

    const dateKeys: string[] = [];
    for (let cursor = new Date(from); cursor < to; cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)) {
      dateKeys.push(toBusinessDateString(cursor));
    }
    const openingByKey = new Map<string, number>();
    const dailyMovementByKey = new Map<
      string,
      { purchasesQty: number; producedQty: number; salesQty: number; adjustmentsQty: number; otherNetQty: number }
    >();
    allMoves.forEach((m: any) => {
      const pid = String(m.product_id || "");
      if (!pid) return;
      const loc = String(m.location || "default");
      const productLocationKey = `${pid}::${loc}`;
      const mvDate = movementDate(m);
      if (Number.isNaN(mvDate.getTime()) || mvDate >= to) return;
      const { inQty, outQty } = effectiveStockMovementInOut(m);
      const netQty = inQty - outQty;
      if (mvDate < from) {
        openingByKey.set(productLocationKey, (openingByKey.get(productLocationKey) || 0) + netQty);
        return;
      }
      const dayKey = `${productLocationKey}::${toBusinessDateString(mvDate)}`;
      const bucket = dailyMovementByKey.get(dayKey) || {
        purchasesQty: 0,
        producedQty: 0,
        salesQty: 0,
        adjustmentsQty: 0,
        otherNetQty: 0,
      };
      const sourceType = String(m.source_type || "").toLowerCase();
      if (isPurchaseMovement(m) && inQty > 0) bucket.purchasesQty += inQty;
      else if (isProductionReceipt(m) && inQty > 0) bucket.producedQty += inQty;
      else if (sourceType === "sale" && outQty > 0) bucket.salesQty += outQty;
      else if (sourceType === "adjustment") bucket.adjustmentsQty += outQty - inQty;
      else bucket.otherNetQty += netQty;
      dailyMovementByKey.set(dayKey, bucket);
    });

    const dailyResult: DailyRow[] = [];
    Array.from(byKey.values()).forEach(({ product_id, location }) => {
      const productLocationKey = `${product_id}::${location}`;
      let balance = openingByKey.get(productLocationKey) || 0;
      dateKeys.forEach((date) => {
        const movement = dailyMovementByKey.get(`${productLocationKey}::${date}`) || {
          purchasesQty: 0,
          producedQty: 0,
          salesQty: 0,
          adjustmentsQty: 0,
          otherNetQty: 0,
        };
        const openingQty = balance;
        balance = openingQty + movement.purchasesQty + movement.producedQty - movement.salesQty - movement.adjustmentsQty + movement.otherNetQty;
        dailyResult.push({ date, product_id, location, openingQty, ...movement, closingQty: balance });
      });
    });

    setRows(result);
    setDailyRows(dailyResult);
    setLoading(false);
  };

  const columnValue = (row: Row, column: MovementColumnKey): string | number => {
    switch (column) {
      case "location": return row.location;
      case "product": return row.product_name;
      case "opening": return row.openingQty;
      case "purchases": return row.purchasedQty;
      case "produced": return row.producedQty;
      case "stockIn": return row.receivedQty;
      case "available": return row.totalOsRec;
      case "sales": return row.salesQty;
      case "salesAmount": return row.salesAmount;
      case "adjustments": return row.rejectsQty;
      case "closing": return row.closingQty;
    }
  };

  const activeColumns = MOVEMENT_COLUMNS.filter((column) => visibleColumns[column.key]);
  const filteredRows = rows.filter((r) => {
    if (selectedLocation && r.location !== selectedLocation) return false;
    if (selectedProductId && r.product_id !== selectedProductId) return false;
    if (!MOVEMENT_COLUMNS.every((column) => matchesColumnFilter(columnValue(r, column.key), columnFilters[column.key] || "", column.numeric))) return false;
    return true;
  });

  const selectedProductName = productsList.find((product) => product.id === selectedProductId)?.name || "Selected item";
  const selectedDailyRows = useMemo(() => {
    if (!selectedProductId) return [];
    const totals = new Map<string, DailyRow>();
    dailyRows
      .filter((row) => row.product_id === selectedProductId && (!selectedLocation || row.location === selectedLocation))
      .forEach((row) => {
        const current = totals.get(row.date) || {
          date: row.date,
          product_id: row.product_id,
          location: selectedLocation || "All locations",
          openingQty: 0,
          purchasesQty: 0,
          producedQty: 0,
          salesQty: 0,
          adjustmentsQty: 0,
          otherNetQty: 0,
          closingQty: 0,
        };
        current.openingQty += row.openingQty;
        current.purchasesQty += row.purchasesQty;
        current.producedQty += row.producedQty;
        current.salesQty += row.salesQty;
        current.adjustmentsQty += row.adjustmentsQty;
        current.otherNetQty += row.otherNetQty;
        current.closingQty += row.closingQty;
        totals.set(row.date, current);
      });
    return Array.from(totals.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [dailyRows, selectedLocation, selectedProductId]);

  const exportReport = (format: "pdf" | "xlsx") => {
    if (loading || filteredRows.length === 0) return;
    const { from, to } = computeRangeInTimezone(dateRange, customFrom, customTo);
    const period = `${toBusinessDateString(from)} to ${toBusinessDateString(new Date(to.getTime() - 1))}`;
    const context = [
      `Period: ${period} (Africa/Kampala)`,
      `Location: ${selectedLocation || "All locations"}`,
      `Item: ${selectedProductId ? selectedProductName : "All items"}`,
    ];
    const sections = [{
      title: "Stock Movement",
      headers: activeColumns.map((column) => column.label),
      data: filteredRows.map((row) => activeColumns.map((column) => columnValue(row, column.key))),
      widths: activeColumns.map((column) => column.width),
    }];
    if (selectedProductId) sections.push({
      title: "Daily Movement",
      headers: ["Date", "Opening", "External purchases", "Produced", "Sales", "Adjustments", "Other net movements", "Closing balance"],
      data: selectedDailyRows.map((r) => [r.date, r.openingQty, r.purchasesQty, r.producedQty, r.salesQty, r.adjustmentsQty, r.otherNetQty, r.closingQty]),
      widths: [16, 18, 18, 16, 18, 18, 24, 20],
    });
    const filename = `stock_movement_${toBusinessDateString(from)}_${toBusinessDateString(new Date(to.getTime() - 1))}`;
    if (format === "xlsx") {
      const workbook = XLSX.utils.book_new();
      for (const section of sections) {
        const sheet = XLSX.utils.aoa_to_sheet([
          [section.title], ...context.map((line) => [line]), [], section.headers, ...section.data,
        ]);
        sheet["!cols"] = section.widths.map((wch) => ({ wch }));
        sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 5, c: 0 }, e: { r: 5 + section.data.length, c: section.headers.length - 1 } }) };
        section.data.forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
          if (typeof value === "number") sheet[XLSX.utils.encode_cell({ r: rowIndex + 6, c: columnIndex })].z = "#,##0.00;[Red](#,##0.00)";
        }));
        XLSX.utils.book_append_sheet(workbook, sheet, section.title);
      }
      XLSX.writeFile(workbook, `${filename}.xlsx`);
      return;
    }
    const doc = new jsPDF("landscape");
    sections.forEach((section, index) => {
      if (index) doc.addPage();
      doc.setFontSize(14);
      doc.text(section.title, 14, 14);
      doc.setFontSize(9);
      const lines = context.flatMap((line) => doc.splitTextToSize(line, 265) as string[]);
      doc.text(lines, 14, 22);
      autoTable(doc, {
        startY: 25 + lines.length * 4,
        head: [section.headers],
        body: section.data.map((row) => row.map((value) => typeof value === "number" ? value.toFixed(2) : value)),
        theme: "grid",
        styles: { fontSize: 8, cellPadding: 2, overflow: "linebreak" },
        headStyles: { fillColor: [15, 23, 42] },
        columnStyles: Object.fromEntries(section.headers.map((_, column) => [column, { halign: column >= (index ? 1 : 2) ? "right" : "left" }])),
        margin: { bottom: 16 },
      });
    });
    for (let page = 1; page <= doc.getNumberOfPages(); page++) {
      doc.setPage(page);
      doc.setFontSize(8);
      doc.text(`Page ${page} of ${doc.getNumberOfPages()}`, 283, 202, { align: "right" });
    }
    doc.save(`${filename}.pdf`);
  };

  const sourceParams = (page: string, sourceId: string | null | undefined) => {
    if (!sourceId) return undefined;
    if (page === "purchases_bills") return { highlightBillId: sourceId };
    if (page === "transactions") return { highlightTransactionId: sourceId };
    if (page === "inventory_store_requisitions") return { highlightRequisitionId: sourceId };
    if (page === "inventory_stock_adjustments") return { highlightAdjustmentSourceId: sourceId };
    return undefined;
  };

  const linkedQuantity = (value: number, page: string | null | undefined, sourceId: string | null | undefined, mixed: boolean | undefined, fallbackTitle: string) => {
    if (!page || value === 0) return value.toFixed(2);
    return <a href={pageHref(page, sourceParams(page, sourceId))} target="_blank" rel="noreferrer" className="text-blue-700 underline hover:text-blue-900" title={mixed ? "Mixed sources — opening first source in new tab" : fallbackTitle}>{value.toFixed(2)}</a>;
  };

  const renderMovementCell = (row: Row, column: MovementColumnKey) => {
    switch (column) {
      case "location": return <span className="capitalize">{row.location}</span>;
      case "product": return row.product_name;
      case "opening": return row.openingQty.toFixed(2);
      case "purchases": return linkedQuantity(row.purchasedQty, row.receivedSourcePage, row.receivedSourceId, row.receivedHasMixedSources, "Open source module in new tab");
      case "produced": return row.producedQty.toFixed(2);
      case "stockIn": return row.receivedQty.toFixed(2);
      case "available": return row.totalOsRec.toFixed(2);
      case "sales": return linkedQuantity(row.salesQty, row.salesSourcePage, row.salesSourceId, row.salesHasMixedSources, "Open source module in new tab");
      case "salesAmount": return row.salesAmount.toFixed(2);
      case "adjustments": return linkedQuantity(row.rejectsQty, row.rejectsSourcePage, row.rejectsSourceId, row.rejectsHasMixedSources, "Open stock adjustments");
      case "closing": return row.closingQty.toFixed(2);
    }
  };

  return (
    <div className="p-6 md:p-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold text-slate-900">Stock Movement</h1>
            <PageNotes ariaLabel="Stock movement help">
              <p>
                <strong>Produced</strong> is finished stock received from completed production. <strong>External purchases</strong> is stock received through supplier bills / GRNs. <strong>Total stock in</strong> combines both sources, and <strong>Total available</strong> is opening stock plus total stock in. <strong>Sales</strong> is POS sale quantity. <strong>Sales amount</strong> is sales qty ×
                product list price (excludes discounts). <strong>Adjustments</strong> is net adjustment quantity (outs − ins) for the period; positive means net stock
                lost.{" "}
                <strong>Closing</strong> includes transfers and all other movements.
              </p>
            </PageNotes>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <button type="button" onClick={() => exportReport("pdf")} disabled={loading || filteredRows.length === 0} className="border rounded-lg px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed">Export PDF</button>
          <button type="button" onClick={() => exportReport("xlsx")} disabled={loading || filteredRows.length === 0} className="border rounded-lg px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed">Export Excel</button>
          <div className="relative">
            <button type="button" onClick={() => setShowColumnPicker((open) => !open)} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-slate-50" aria-expanded={showColumnPicker}>
              <Columns3 className="h-4 w-4" /> Columns
            </button>
            {showColumnPicker && <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
              <div className="mb-2 flex items-center justify-between"><p className="text-sm font-semibold text-slate-800">Show columns</p><button type="button" onClick={() => setVisibleColumns(initialVisibleColumns)} className="text-xs font-medium text-brand-700 hover:underline">Reset</button></div>
              <div className="space-y-1">{MOVEMENT_COLUMNS.map((column) => <label key={column.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50"><input type="checkbox" checked={visibleColumns[column.key]} onChange={(event) => setVisibleColumns((current) => ({ ...current, [column.key]: event.target.checked }))} /><span>{column.label}</span></label>)}</div>
            </div>}
          </div>
          {Object.values(columnFilters).some(Boolean) && <button type="button" onClick={() => setColumnFilters({})} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><X className="h-4 w-4" /> Clear column filters</button>}
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value as DateRangeKey)}
            className="border rounded-lg px-3 py-2"
          >
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="this_week">This week</option>
            <option value="this_month">This month</option>
            <option value="last_month">Last month</option>
            <option value="custom">Custom</option>
          </select>
          {dateRange === "custom" && (
            <>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="border rounded-lg px-3 py-2"
              />
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="border rounded-lg px-3 py-2"
              />
            </>
          )}
          <select
            value={selectedLocation}
            onChange={(e) => setSelectedLocation(e.target.value)}
            className="border rounded-lg px-3 py-2"
          >
            <option value="">All locations</option>
            {Array.from(new Set(rows.map((r) => r.location))).map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
          </select>
          <select
            value={selectedProductId}
            onChange={(e) => setSelectedProductId(e.target.value)}
            className="border rounded-lg px-3 py-2"
          >
            <option value="">All items</option>
            {productsList.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-slate-500">Loading…</div>
      ) : (
        <div className="space-y-6">
        {selectedProductId && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <div className="px-4 py-3 border-b border-slate-200">
              <h2 className="font-semibold text-slate-900">Daily movement: {selectedProductName}</h2>
              <p className="text-xs text-slate-500">Each closing balance carries forward as the next day's opening balance.</p>
            </div>
            <table className="w-full text-sm min-w-[880px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className="p-3 text-left">Date</th>
                  <th className="p-3 text-right">Opening</th>
                  <th className="p-3 text-right">External purchases</th>
                  <th className="p-3 text-right">Produced</th>
                  <th className="p-3 text-right">Sales</th>
                  <th className="p-3 text-right">Adjustments</th>
                  <th className="p-3 text-right">Other net movements</th>
                  <th className="p-3 text-right">Closing balance</th>
                </tr>
              </thead>
              <tbody>
                {selectedDailyRows.map((row) => (
                  <tr key={row.date} className="border-t">
                    <td className="p-3 whitespace-nowrap">{new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Africa/Kampala" }).format(new Date(`${row.date}T12:00:00Z`))}</td>
                    <td className="p-3 text-right tabular-nums">{row.openingQty.toFixed(2)}</td>
                    <td className="p-3 text-right tabular-nums">{row.purchasesQty.toFixed(2)}</td>
                    <td className="p-3 text-right tabular-nums">{row.producedQty.toFixed(2)}</td>
                    <td className="p-3 text-right tabular-nums">{row.salesQty.toFixed(2)}</td>
                    <td className="p-3 text-right tabular-nums">{row.adjustmentsQty.toFixed(2)}</td>
                    <td className="p-3 text-right tabular-nums">{row.otherNetQty.toFixed(2)}</td>
                    <td className="p-3 text-right font-semibold tabular-nums">{row.closingQty.toFixed(2)}</td>
                  </tr>
                ))}
                {selectedDailyRows.length === 0 && (
                  <tr><td colSpan={8} className="p-6 text-center text-slate-500">No stock ledger exists for this item.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-2 text-xs text-slate-500"><SlidersHorizontal className="mr-1 inline h-3.5 w-3.5" />Filter each visible column below. For quantities, use a number or comparison such as <strong>&gt;0</strong> or <strong>&lt;=10</strong>. Scroll sideways to see wide tables.</div>
          <div className="overflow-x-scroll overscroll-x-contain scroll-smooth" aria-label="Stock movement table; scroll horizontally for more columns">
            <table className="w-full min-w-max text-sm">
              <thead className="bg-slate-50">
                <tr>{activeColumns.map((column) => <th key={column.key} className={`min-w-36 p-3 align-top ${column.numeric ? "text-right" : "text-left"}`}><span className="block whitespace-nowrap">{column.label}</span><input value={columnFilters[column.key] || ""} onChange={(event) => setColumnFilters((current) => ({ ...current, [column.key]: event.target.value }))} placeholder={column.numeric ? ">0" : "Filter"} className={`mt-2 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs font-normal normal-case text-slate-700 placeholder:text-slate-400 ${column.numeric ? "text-right" : "text-left"}`} aria-label={`Filter ${column.label}`} /></th>)}</tr>
              </thead>
              <tbody>
                {filteredRows.map((row, index) => <tr key={`${row.product_id}-${row.location}-${index}`} className="border-t hover:bg-slate-50">{activeColumns.map((column) => <td key={column.key} className={`p-3 tabular-nums ${column.numeric ? "text-right" : "text-left"}`}>{renderMovementCell(row, column.key)}</td>)}</tr>)}
                {filteredRows.length === 0 && <tr><td colSpan={Math.max(activeColumns.length, 1)} className="p-6 text-center text-slate-500">{rows.length === 0 ? "No stock movements in this period." : "No rows match the selected filters."}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        </div>
      )}
    </div>
  );
}
