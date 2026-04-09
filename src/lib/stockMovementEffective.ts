/**
 * Effective in/out quantities for a stock movement row (aligned with StockMovementReportPage).
 */
export function effectiveStockMovementInOut(m: {
  quantity_in?: number | null;
  quantity_out?: number | null;
  source_type?: string | null;
  note?: string | null;
}): { inQty: number; outQty: number } {
  const st = String(m.source_type || "").toLowerCase();
  const note = String(m.note || "").toLowerCase();
  const qiRaw = Number(m.quantity_in) || 0;
  const qoRaw = Number(m.quantity_out) || 0;

  if (["bill", "grn", "purchase", "vendor_bill", "vendor_payment"].includes(st) || note.includes("grn") || note.includes("purchase")) {
    const qty = Math.max(Math.abs(qiRaw), Math.abs(qoRaw));
    return { inQty: qty, outQty: 0 };
  }

  if (st === "sale") {
    const qty = Math.max(Math.abs(qoRaw), Math.abs(qiRaw));
    return { inQty: 0, outQty: qty };
  }

  if (st === "transfer") {
    return { inQty: Math.max(0, qiRaw), outQty: Math.max(0, qoRaw) };
  }

  if (st === "adjustment") {
    if (qiRaw > 0 && qoRaw <= 0) return { inQty: qiRaw, outQty: 0 };
    if (qoRaw > 0 && qiRaw <= 0) return { inQty: 0, outQty: qoRaw };
    if (qiRaw > 0 && qoRaw > 0) {
      if (qiRaw >= qoRaw) return { inQty: qiRaw - qoRaw, outQty: 0 };
      return { inQty: 0, outQty: qoRaw - qiRaw };
    }
  }

  return { inQty: Math.max(0, qiRaw), outQty: Math.max(0, qoRaw) };
}
