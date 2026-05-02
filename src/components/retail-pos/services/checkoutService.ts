import { supabase } from "../../../lib/supabase";
import type { OfflineRetailLine, OfflineRetailPayment } from "../../../lib/retailOfflineQueue";
import type { PaymentMethodCode } from "../../../lib/paymentMethod";

type MobileCollectionResponse = { status?: string; message?: string };

export interface SaleCustomerContext {
  id: string | null;
  name: string | null;
  phone: string | null;
}

export interface PersistRetailSaleLedgerArgs {
  saleId: string;
  lines: OfflineRetailLine[];
  tenders: OfflineRetailPayment[];
  organizationId: string | undefined;
  processedBy: string | null;
  saleCustomer: SaleCustomerContext;
  total: number;
  amountPaid: number;
  amountDue: number;
  changeDue: number;
  paymentStatus: "pending" | "partial" | "completed" | "overpaid";
  saleType: "cash" | "credit" | "mixed";
  creditDueDate: string;
  posVatEnabled: boolean;
  posVatRate: number | null;
  cashierSessionId: string | null;
}

export interface CollectMobileMoneyPaymentsArgs {
  saleId: string;
  tenders: Array<OfflineRetailPayment & { id: string }>;
  phone: string;
  customerName: string;
  customerEmail: string;
  organizationId: string | null;
}

export const normalizeMobilePhone = (raw: string) => {
  const digits = raw.replace(/[^\d+]/g, "").trim();
  if (!digits) return "";
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("0")) return `+256${digits.slice(1)}`;
  if (digits.startsWith("256")) return `+${digits}`;
  return `+${digits}`;
};

export async function collectMobileMoneyPayments({
  saleId,
  tenders,
  phone,
  customerName,
  customerEmail,
  organizationId,
}: CollectMobileMoneyPaymentsArgs): Promise<Array<OfflineRetailPayment & { id: string }>> {
  const pending = tenders.filter((t) => t.status === "pending");
  if (pending.length === 0) return tenders;
  const normalizedPhone = normalizeMobilePhone(phone);
  for (const line of pending) {
    const network = line.method === "mtn_mobile_money" ? "mtn" : "airtel";
    const { data, error } = await supabase.functions.invoke("flutterwave-mobile-money", {
      body: {
        action: "collect",
        network,
        amount: line.amount,
        currency: "UGX",
        phone_number: normalizedPhone,
        customer_name: customerName,
        customer_email: customerEmail,
        tx_ref: `${saleId}-${line.id}`,
        sale_id: saleId,
        organization_id: organizationId,
        payment_method: line.method,
        timeout_seconds: 60,
      },
    });
    if (error) {
      throw new Error(error.message || "Failed to initiate mobile money payment.");
    }
    const status = (data as MobileCollectionResponse | null)?.status;
    if (status !== "successful") {
      const detail = (data as MobileCollectionResponse | null)?.message || "Mobile money payment failed.";
      throw new Error(detail);
    }
  }
  return tenders.map((t) => (t.status === "pending" ? { ...t, status: "completed" } : t));
}

export async function persistRetailSaleLedger({
  saleId,
  lines,
  tenders,
  organizationId,
  processedBy,
  saleCustomer,
  total,
  amountPaid,
  amountDue,
  changeDue,
  paymentStatus,
  saleType,
  creditDueDate,
  posVatEnabled,
  posVatRate,
  cashierSessionId,
}: PersistRetailSaleLedgerArgs): Promise<boolean> {
  if (!organizationId) return false;
  const { data: existingSale, error: existingErr } = await supabase
    .from("retail_sales")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("idempotency_key", saleId)
    .maybeSingle();
  if (existingErr || existingSale?.id) return false;

  const payload = {
    id: saleId,
    organization_id: organizationId,
    sale_at: new Date().toISOString(),
    idempotency_key: saleId,
    customer_id: saleCustomer.id,
    customer_name: saleCustomer.name,
    customer_phone: saleCustomer.phone,
    total_amount: total,
    amount_paid: amountPaid,
    amount_due: amountDue,
    change_amount: changeDue,
    payment_status: paymentStatus,
    sale_type: saleType,
    credit_due_date: creditDueDate || null,
    vat_enabled: posVatEnabled,
    vat_rate: posVatRate,
    created_by: processedBy,
    cashier_session_id: cashierSessionId,
  };
  const { error: saleErr } = await supabase.from("retail_sales").insert(payload);
  if (saleErr) return false;

  const lineRows = lines.map((line, idx) => ({
    sale_id: saleId,
    line_no: idx + 1,
    product_id: line.productId,
    description: line.name,
    quantity: line.quantity,
    unit_price: line.unitPrice,
    line_total: line.lineTotal,
    unit_cost: line.costPrice,
    department_id: line.departmentId,
    track_inventory: line.trackInventory,
  }));
  if (lineRows.length > 0) {
    await supabase.from("retail_sale_lines").insert(lineRows);
  }
  const payRows = tenders.map((p) => ({
    sale_id: saleId,
    payment_method: p.method as PaymentMethodCode,
    amount: p.amount,
    payment_status: p.status,
  }));
  if (payRows.length > 0) {
    await supabase.from("retail_sale_payments").insert(payRows);
  }
  return true;
}
