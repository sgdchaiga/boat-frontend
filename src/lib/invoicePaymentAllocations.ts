/** Parse invoice_allocations JSON from payments (same shape as vendor bill_allocations). */
export type InvoiceAllocationSlice = { invoice_id: string; amount: number };

export function parseInvoiceAllocationsJson(raw: unknown): InvoiceAllocationSlice[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return [];
  const out: InvoiceAllocationSlice[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as { invoice_id?: unknown; amount?: unknown };
    const invoice_id = typeof o.invoice_id === "string" ? o.invoice_id : null;
    const amount = Number(o.amount);
    if (!invoice_id || !Number.isFinite(amount) || amount <= 0) continue;
    out.push({ invoice_id, amount });
  }
  return out;
}

/** Total amount previously allocated to an invoice from payment rows (completed). */
export function totalAllocatedToInvoice(
  payments: Array<{ invoice_allocations?: unknown; payment_status?: string }>,
  invoiceId: string
): number {
  let sum = 0;
  for (const p of payments) {
    if (p.payment_status && p.payment_status !== "completed") continue;
    for (const s of parseInvoiceAllocationsJson(p.invoice_allocations)) {
      if (s.invoice_id === invoiceId) sum += s.amount;
    }
  }
  return sum;
}

export type InvoiceSettlementPaymentLink = { id: string; amount: number; paid_at: string };

export type InvoiceSettlementMap = Record<
  string,
  { paid: number; payments: InvoiceSettlementPaymentLink[] }
>;

/** Completed payments with `invoice_allocations` → per-invoice paid total and payment rows. */
export function buildInvoiceSettlementMap(
  payments: Array<{ id: string; paid_at: string; payment_status?: string | null; invoice_allocations?: unknown }>
): InvoiceSettlementMap {
  const map: InvoiceSettlementMap = {};
  for (const p of payments) {
    if (p.payment_status && p.payment_status !== "completed") continue;
    for (const slice of parseInvoiceAllocationsJson(p.invoice_allocations)) {
      const cur = map[slice.invoice_id] ?? { paid: 0, payments: [] };
      cur.paid += slice.amount;
      const idx = cur.payments.findIndex((x) => x.id === p.id);
      if (idx >= 0) cur.payments[idx].amount += slice.amount;
      else cur.payments.push({ id: p.id, amount: slice.amount, paid_at: p.paid_at });
      map[slice.invoice_id] = cur;
    }
  }
  for (const k of Object.keys(map)) {
    map[k].paid = Math.round(map[k].paid * 100) / 100;
    for (const x of map[k].payments) {
      x.amount = Math.round(x.amount * 100) / 100;
    }
    map[k].payments.sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime());
  }
  return map;
}

/** Outstanding balance for a retail invoice given settlement from `buildInvoiceSettlementMap`. */
export function invoiceBalanceDue(inv: { id: string; total: number }, settlement: InvoiceSettlementMap): number {
  const paid = settlement[inv.id]?.paid ?? 0;
  return Math.max(0, Math.round((Number(inv.total) - paid) * 100) / 100);
}
