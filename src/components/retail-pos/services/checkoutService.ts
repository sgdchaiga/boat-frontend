import { supabase } from "../../../lib/supabase";
import type { OfflineRetailLine, OfflineRetailPayment } from "../../../lib/retailOfflineQueue";
import type { PaymentMethodCode } from "../../../lib/paymentMethod";

export type MobileMoneyGatewayProvider = "flutterwave" | "dpo";

type MobileCollectionResponse = { status?: string; message?: string; transaction_id?: string | number; tx_ref?: string };

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
  clinicPatientId?: string | null;
  clinicDiagnosisSnapshot?: string | null;
  saleAt: string;
}

export interface CollectMobileMoneyPaymentsArgs {
  saleId: string;
  tenders: Array<OfflineRetailPayment & { id: string }>;
  phone: string;
  customerName: string;
  customerEmail: string;
  organizationId: string | null;
  gatewayProvider?: MobileMoneyGatewayProvider;
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
  gatewayProvider = "flutterwave",
}: CollectMobileMoneyPaymentsArgs): Promise<Array<OfflineRetailPayment & { id: string }>> {
  const pending = tenders.filter((t) => t.status === "pending");
  if (pending.length === 0) return tenders;
  const normalizedPhone = normalizeMobilePhone(phone);
  const completedRefs = new Map<string, { txRef: string; transactionId: number | null }>();
  for (const line of pending) {
    const network = line.method === "mtn_mobile_money" ? "mtn" : "airtel";
    const txRef = `${saleId}-${line.id}`;
    const functionName = gatewayProvider === "dpo" ? "dpo-mobile-money" : "flutterwave-mobile-money";
    const { data, error } = await supabase.functions.invoke(functionName, {
      body: {
        action: "collect",
        network,
        amount: line.amount,
        currency: "UGX",
        phone_number: normalizedPhone,
        customer_name: customerName,
        customer_email: customerEmail,
        tx_ref: txRef,
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
    completedRefs.set(line.id, {
      txRef: (data as MobileCollectionResponse | null)?.tx_ref || txRef,
      transactionId: Number((data as MobileCollectionResponse | null)?.transaction_id) || null,
    });
  }
  return tenders.map((t) => {
    if (t.status !== "pending") return t;
    const ref = completedRefs.get(t.id);
    return {
      ...t,
      status: "completed",
      reference: ref?.txRef ?? t.reference ?? null,
      gatewayTransactionId: ref?.transactionId ?? t.gatewayTransactionId ?? null,
    };
  });
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
  clinicPatientId,
  clinicDiagnosisSnapshot,
  saleAt,
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
    sale_at: saleAt,
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
    clinic_patient_id: clinicPatientId ?? null,
    clinic_diagnosis_snapshot: clinicDiagnosisSnapshot?.trim() || null,
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
    reference: p.reference ?? null,
    receipt_gl_account_id: p.glAccountId ?? null,
    paid_at: saleAt,
  }));
  if (payRows.length > 0) {
    await supabase.from("retail_sale_payments").insert(payRows);
  }
  return true;
}
