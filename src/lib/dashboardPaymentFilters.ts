/**
 * Classify POS / hospitality payments for retail vs hotel dashboards.
 * Prefer `payment_source`; fall back to stay_id / kitchen_orders id heuristics.
 */

import { formatPaymentMethodLabel } from "./paymentMethod";

export type DashboardPayment = {
  amount: number | null;
  payment_status?: string | null;
  payment_source?: string | null;
  stay_id?: string | null;
  transaction_id?: string | null;
  paid_at?: string;
  payment_method?: string | null;
};

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isUuid(s: string | null | undefined): boolean {
  return !!s && UUID_RE.test(String(s));
}

/** Completed retail POS receipt (shop floor). */
export function isRetailPosPayment(p: DashboardPayment, kitchenOrderIds: Set<string>): boolean {
  if (p.payment_status !== "completed") return false;
  const src = p.payment_source;
  if (src === "pos_retail") return true;
  if (src === "pos_hotel" || src === "debtor") return false;
  const tid = p.transaction_id != null ? String(p.transaction_id).trim() : "";
  if (!tid) return false;
  if (p.stay_id != null) return false;
  if (!isUuid(tid)) return false;
  return !kitchenOrderIds.has(tid);
}

/** Hotel: stay payments, hotel POS, kitchen-order-linked cash, debtor collections. */
export function isHotelHospitalityPayment(p: DashboardPayment, kitchenOrderIds: Set<string>): boolean {
  if (p.payment_status !== "completed") return false;
  const src = p.payment_source;
  if (src === "pos_retail") return false;
  if (src === "pos_hotel" || src === "debtor") return true;
  if (p.stay_id != null) return true;
  const tid = p.transaction_id != null ? String(p.transaction_id) : "";
  if (tid && isUuid(tid) && kitchenOrderIds.has(tid)) return true;
  return false;
}

export type HotelRevenueBucket = "pos_hotel" | "stay" | "kitchen" | "debtor" | "none";

export function hotelRevenueBucket(p: DashboardPayment, kitchenOrderIds: Set<string>): HotelRevenueBucket {
  if (p.payment_status !== "completed") return "none";
  if (p.payment_source === "pos_retail") return "none";
  if (p.payment_source === "debtor") return "debtor";
  if (p.payment_source === "pos_hotel") return "pos_hotel";
  if (p.stay_id != null) return "stay";
  const tid = p.transaction_id != null ? String(p.transaction_id) : "";
  if (tid && isUuid(tid) && kitchenOrderIds.has(tid)) return "kitchen";
  return "none";
}

export function sumByMethod(
  payments: DashboardPayment[],
  filter: (p: DashboardPayment) => boolean
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of payments) {
    if (!filter(p)) continue;
    const m = formatPaymentMethodLabel(p.payment_method || "other");
    const amt = Number(p.amount ?? 0);
    out[m] = (out[m] ?? 0) + amt;
  }
  return out;
}

export function aggregateRetailByBusinessDay(
  payments: DashboardPayment[],
  kitchenOrderIds: Set<string>,
  dayKeys: string[]
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const d of dayKeys) totals[d] = 0;
  for (const p of payments) {
    if (!isRetailPosPayment(p, kitchenOrderIds)) continue;
    if (!p.paid_at) continue;
    const day = p.paid_at.slice(0, 10);
    if (totals[day] === undefined) continue;
    totals[day] += Number(p.amount ?? 0);
  }
  return totals;
}
