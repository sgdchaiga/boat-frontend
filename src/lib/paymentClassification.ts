import type { Database } from "./database.types";
import { parseInvoiceAllocationsJson } from "./invoicePaymentAllocations";

export type PaymentRow = Database["public"]["Tables"]["payments"]["Row"];

export type PaymentSource = "pos_hotel" | "pos_retail" | "debtor";

/** Legacy classification when `payment_source` is not set (DB not migrated yet). */
function legacyIsPosCashReceipt(
  p: Pick<
    PaymentRow,
    "payment_status" | "transaction_id" | "stay_id" | "property_customer_id" | "retail_customer_id" | "invoice_allocations"
  >
): boolean {
  if (p.payment_status !== "completed") return false;
  const tid = p.transaction_id != null && String(p.transaction_id).trim() !== "";
  if (!tid) return false;
  if (p.stay_id != null) return false;
  if (p.property_customer_id != null || p.retail_customer_id != null) return false;
  if (parseInvoiceAllocationsJson(p.invoice_allocations).length > 0) return false;
  return true;
}

/**
 * Immediate POS cash (Hotel or Retail POS pay now). Uses `payment_source` when present.
 */
export function isPosCashReceipt(p: PaymentRow): boolean {
  const src = p.payment_source;
  if (src === "pos_hotel" || src === "pos_retail") {
    return p.payment_status === "completed";
  }
  if (src === "debtor") return false;
  return legacyIsPosCashReceipt(p);
}

export function isDebtorPayment(p: PaymentRow): boolean {
  const src = p.payment_source;
  if (src === "debtor") return true;
  if (src === "pos_hotel" || src === "pos_retail") return false;
  return !legacyIsPosCashReceipt(p);
}
