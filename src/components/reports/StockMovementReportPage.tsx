import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { computeRangeInTimezone, businessDayRangeForDateString, type DateRangeKey } from "../../lib/timezone";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import { PageNotes } from "../common/PageNotes";

interface Row {
  product_id: string;
  product_name: string;
  location: string;
  openingQty: number;
  /** Purchases / GRN / vendor receipts in period (not transfers or positive adjustments). */
  receivedQty: number;
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

export function StockMovementReportPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!user?.isSuperAdmin;

  const [dateRange, setDateRange] = useState<DateRangeKey>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLocation, setSelectedLocation] = useState<string>("");
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [productsList, setProductsList] = useState<{ id: string; name: string }[]>([]);

  const sourceTypeToPage = (sourceType: string | null | undefined): string | null => {
    const st = String(sourceType || "").toLowerCase();
    if (!st) return null;
    if (["bill", "grn", "purchase", "vendor_bill", "vendor_payment"].includes(st)) return "purchases_bills";
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

    const [{ data: moves }, { data: products }] = await Promise.all([
      filterByOrganizationId(
        supabase
          .from("product_stock_movements")
          .select("product_id, movement_date, quantity_in, quantity_out, unit_cost, location, source_type, source_id, note"),
        orgId,
        superAdmin
      ),
      filterByOrganizationId(
        supabase.from("products").select("id, name, department_id, cost_price, sales_price"),
        orgId,
        superAdmin
      ),
    ]);

    const byKey = new Map<
      string,
      {
        product_id: string;
        location: string;
        openingQty: number;
        periodInQty: number;
        periodOutQty: number;
        receivedQty: number;
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

    const effectiveInOut = (m: any): { inQty: number; outQty: number } => {
      const st = String(m.source_type || "").toLowerCase();
      const note = String(m.note || "").toLowerCase();
      const qiRaw = Number(m.quantity_in) || 0;
      const qoRaw = Number(m.quantity_out) || 0;

      // Business rules:
      // OUT = sold qty + transfer out + negative adjustments
      // IN  = purchases + transfer in + positive adjustments

      // Purchases/GRN/Vendor bills are always stock-in.
      if (["bill", "grn", "purchase", "vendor_bill", "vendor_payment"].includes(st) || note.includes("grn") || note.includes("purchase")) {
        const qty = Math.max(Math.abs(qiRaw), Math.abs(qoRaw));
        return { inQty: qty, outQty: 0 };
      }

      // Sales are always stock-out.
      if (st === "sale") {
        const qty = Math.max(Math.abs(qoRaw), Math.abs(qiRaw));
        return { inQty: 0, outQty: qty };
      }

      // Transfers can be either in or out per row, rely on recorded direction.
      if (st === "transfer") {
        return { inQty: Math.max(0, qiRaw), outQty: Math.max(0, qoRaw) };
      }

      // Adjustments: positive adjustment increases stock, negative decreases stock.
      if (st === "adjustment") {
        if (qiRaw > 0 && qoRaw <= 0) return { inQty: qiRaw, outQty: 0 };
        if (qoRaw > 0 && qiRaw <= 0) return { inQty: 0, outQty: qoRaw };
        if (qiRaw > 0 && qoRaw > 0) {
          // Keep net effect if both columns were populated accidentally.
          if (qiRaw >= qoRaw) return { inQty: qiRaw - qoRaw, outQty: 0 };
          return { inQty: 0, outQty: qoRaw - qiRaw };
        }
      }

      // Default fallback: trust stored movement direction.
      return { inQty: Math.max(0, qiRaw), outQty: Math.max(0, qoRaw) };
    };

    const isPurchaseMovement = (m: any): boolean => {
      const st = String(m.source_type || "").toLowerCase();
      const note = String(m.note || "").toLowerCase();
      return (
        ["bill", "grn", "purchase", "vendor_bill", "vendor_payment"].includes(st) ||
        note.includes("grn") ||
        note.includes("purchase")
      );
    };

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
      const { inQty: qiEff } = effectiveInOut(m);
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

    const movementDate = (raw: unknown): Date => {
      const s = String(raw || "");
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
      const mvDate = movementDate(m.movement_date);
      if (mvDate >= to) {
        // Exclude future/out-of-range rows from current report slice entirely.
        return;
      }
      const { inQty: qiEff, outQty: qoEff } = effectiveInOut(m);
      const qtyNet = qiEff - qoEff;

      if (mvDate < from) {
        row.openingQty += qtyNet;
      } else if (mvDate >= from && mvDate < to) {
        row.periodInQty += qiEff;
        row.periodOutQty += qoEff;

        const stLower = String(m.source_type || "").toLowerCase();

        if (isPurchaseMovement(m) && qiEff > 0) {
          row.receivedQty += qiEff;
          const sourcePage = sourceTypeToPage(stLower);
          row.receivedSourceTypes.add(stLower);
          if (m.source_id) row.receivedSourceIds.add(String(m.source_id));
          if (!row.receivedSourcePageCandidate && sourcePage) {
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

    setRows(result);
    setLoading(false);
  };

  const filteredRows = rows.filter((r) => {
    if (selectedLocation && r.location !== selectedLocation) return false;
    if (selectedProductId && r.product_id !== selectedProductId) return false;
    return true;
  });

  return (
    <div className="p-6 md:p-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold text-slate-900">Stock Movement</h1>
            <PageNotes ariaLabel="Stock movement help">
              <p>
                <strong>Received</strong> is stock from purchases / GRN. <strong>Total (OS+Rec)</strong> is opening plus
                received. <strong>Sales</strong> is POS sale quantity. <strong>Sales amount</strong> is sales qty ×
                product list price (excludes discounts).                 <strong>Rejects</strong> is net adjustment quantity (outs − ins) for the period; positive means net stock
                lost.{" "}
                <strong>Closing</strong> includes transfers and all other movements.
              </p>
            </PageNotes>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
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
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[960px]">
            <thead className="bg-slate-50">
              <tr>
                <th className="p-3 text-left">Location</th>
                <th className="p-3 text-left">Product</th>
                <th className="p-3 text-right">Opening stock</th>
                <th className="p-3 text-right">Received</th>
                <th className="p-3 text-right">Total (OS+Rec)</th>
                <th className="p-3 text-right">Sales</th>
                <th className="p-3 text-right">Sales amount</th>
                <th className="p-3 text-right">Rejects</th>
                <th className="p-3 text-right">Closing stock</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r, idx) => (
                <tr key={`${r.product_id}-${r.location}-${idx}`} className="border-t">
                  <td className="p-3 capitalize">{r.location}</td>
                  <td className="p-3">{r.product_name}</td>
                  <td className="p-3 text-right tabular-nums">{r.openingQty.toFixed(2)}</td>
                  <td className="p-3 text-right tabular-nums">
                    {r.receivedSourcePage && r.receivedQty > 0 ? (
                      <a
                        href={pageHref(
                          r.receivedSourcePage,
                          r.receivedSourcePage === "purchases_bills" && r.receivedSourceId
                            ? { highlightBillId: r.receivedSourceId }
                            : r.receivedSourcePage === "transactions" && r.receivedSourceId
                              ? { highlightTransactionId: r.receivedSourceId }
                              : r.receivedSourcePage === "inventory_store_requisitions" && r.receivedSourceId
                                ? { highlightRequisitionId: r.receivedSourceId }
                                : r.receivedSourcePage === "inventory_stock_adjustments" && r.receivedSourceId
                                  ? { highlightAdjustmentSourceId: r.receivedSourceId }
                                  : undefined
                        )}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-700 hover:text-blue-900 underline"
                        title={
                          r.receivedHasMixedSources
                            ? "Mixed sources — opening first source in new tab"
                            : "Open source module in new tab"
                        }
                      >
                        {r.receivedQty.toFixed(2)}
                      </a>
                    ) : (
                      r.receivedQty.toFixed(2)
                    )}
                  </td>
                  <td className="p-3 text-right tabular-nums">{r.totalOsRec.toFixed(2)}</td>
                  <td className="p-3 text-right tabular-nums">
                    {r.salesSourcePage && r.salesQty > 0 ? (
                      <a
                        href={pageHref(
                          r.salesSourcePage,
                          r.salesSourcePage === "purchases_bills" && r.salesSourceId
                            ? { highlightBillId: r.salesSourceId }
                            : r.salesSourcePage === "transactions" && r.salesSourceId
                              ? { highlightTransactionId: r.salesSourceId }
                              : r.salesSourcePage === "inventory_store_requisitions" && r.salesSourceId
                                ? { highlightRequisitionId: r.salesSourceId }
                                : r.salesSourcePage === "inventory_stock_adjustments" && r.salesSourceId
                                  ? { highlightAdjustmentSourceId: r.salesSourceId }
                                  : undefined
                        )}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-700 hover:text-blue-900 underline"
                        title={
                          r.salesHasMixedSources
                            ? "Mixed sources — opening first source in new tab"
                            : "Open source module in new tab"
                        }
                      >
                        {r.salesQty.toFixed(2)}
                      </a>
                    ) : (
                      r.salesQty.toFixed(2)
                    )}
                  </td>
                  <td className="p-3 text-right tabular-nums">{r.salesAmount.toFixed(2)}</td>
                  <td className="p-3 text-right tabular-nums">
                    {r.rejectsSourcePage && r.rejectsQty !== 0 ? (
                      <a
                        href={pageHref(
                          r.rejectsSourcePage,
                          r.rejectsSourcePage === "inventory_stock_adjustments" && r.rejectsSourceId
                            ? { highlightAdjustmentSourceId: r.rejectsSourceId }
                            : undefined
                        )}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-700 hover:text-blue-900 underline"
                        title={
                          r.rejectsHasMixedSources
                            ? "Mixed sources — opening first source in new tab"
                            : "Open stock adjustments"
                        }
                      >
                        {r.rejectsQty.toFixed(2)}
                      </a>
                    ) : (
                      r.rejectsQty.toFixed(2)
                    )}
                  </td>
                  <td className="p-3 text-right tabular-nums">{r.closingQty.toFixed(2)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-slate-500">
                    No stock movements in this period.
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

