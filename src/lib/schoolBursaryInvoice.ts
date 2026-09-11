type InvoiceAmounts = {
  subtotal: number;
  discount_amount: number;
  scholarship_amount: number;
  amount_paid: number;
  status: string;
};

export function bursaryInvoiceChanges(invoice: InvoiceAmounts, amount: number) {
  if (invoice.status === "cancelled") return null;
  const total_due = Math.max(0, Math.round((Number(invoice.subtotal)
    - Number(invoice.discount_amount || 0) - Number(invoice.scholarship_amount || 0) - amount) * 100) / 100);
  const paid = Number(invoice.amount_paid || 0);
  const status = invoice.status === "draft" ? "draft"
    : paid >= total_due ? "paid" : paid > 0 ? "partial" : "sent";
  return { bursary_amount: amount, total_due, status };
}
