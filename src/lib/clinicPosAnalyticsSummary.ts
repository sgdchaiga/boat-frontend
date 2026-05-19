import { supabase } from "@/lib/supabase";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";
import type { DashboardPayment } from "@/lib/dashboardPaymentFilters";
import { fetchClinicDispensingSaleIdsInRange } from "@/lib/clinicDispensingHistory";

/** KPI totals aligned with POS Analytics, scoped to clinic dispensing. */
export type ClinicPosPeriodSummary = {
  completedCount: number;
  salesValue: number;
  refundedValue: number;
  outstandingCredit: number;
  overdueCredit: number;
  openCreditSaleCount: number;
};

type SaleRow = {
  id: string;
  clinic_patient_id: string | null;
  clinic_diagnosis_snapshot: string | null;
};

type PaymentRow = DashboardPayment & {
  id?: string;
  source_documents?: Record<string, unknown> | null;
};

function sourceDocClinicPatientId(doc: Record<string, unknown> | null | undefined): string | null {
  if (!doc || typeof doc !== "object") return null;
  const v = doc.clinic_patient_id;
  return v != null && String(v).trim() !== "" ? String(v) : null;
}

/** Same rules as POS orders: sale is clinic dispensing if tagged or paid as clinic POS. */
export function isClinicDispensingSale(sale: SaleRow, paymentsForSale: PaymentRow[]): boolean {
  if (sale.clinic_patient_id || (sale.clinic_diagnosis_snapshot || "").trim()) return true;
  for (const p of paymentsForSale) {
    if (p.payment_source === "pos_clinic") return true;
    if (sourceDocClinicPatientId(p.source_documents as Record<string, unknown> | null)) return true;
  }
  // Legacy clinic workspace / pharmacy POS: retail_sales + pos_retail (no shop-floor hotel link)
  for (const p of paymentsForSale) {
    if (p.payment_source === "pos_retail" && p.stay_id == null) return true;
  }
  return false;
}

const PAYMENT_CHUNK = 200;

/** Payments linked to retail_sales in period (by sale_at), for clinic analytics tables. */
export async function fetchPaymentsForRetailSalesInPeriod(
  orgId: string | undefined,
  superAdmin: boolean,
  from: Date,
  to: Date
): Promise<PaymentRow[]> {
  const skipOrgFilter = superAdmin && !orgId;
  const saleIds = [...(await fetchClinicDispensingSaleIdsInRange(orgId, superAdmin, from, to))];
  const out: PaymentRow[] = [];
  for (let i = 0; i < saleIds.length; i += PAYMENT_CHUNK) {
    const chunk = saleIds.slice(i, i + PAYMENT_CHUNK);
    if (chunk.length === 0) continue;
    let payQ = supabase
      .from("payments")
      .select(
        "id, transaction_id, paid_at, amount, payment_method, payment_status, stay_id, processed_by, payment_source, source_documents"
      )
      .in("transaction_id", chunk)
      .is("stay_id", null);
    payQ = filterByOrganizationId(payQ, orgId, skipOrgFilter);
    const { data, error } = await payQ;
    if (error) throw new Error(error.message);
    out.push(...((data || []) as PaymentRow[]));
  }
  return out;
}

export async function loadClinicPosPeriodSummary(
  orgId: string | undefined,
  superAdmin: boolean,
  from: Date,
  to: Date
): Promise<ClinicPosPeriodSummary> {
  const skipOrgFilter = superAdmin && !orgId;

  // Match POS Orders: period is by retail_sales.sale_at, not payments.paid_at only.
  let salesQ = supabase
    .from("retail_sales")
    .select("id, clinic_patient_id, clinic_diagnosis_snapshot")
    .gte("sale_at", from.toISOString())
    .lt("sale_at", to.toISOString());
  salesQ = filterByOrganizationId(salesQ, orgId, skipOrgFilter);

  let openCreditQ = filterByOrganizationId(
    supabase
      .from("retail_sales")
      .select("id, amount_due, credit_due_date")
      .gt("amount_due", 0)
      .in("payment_status", ["pending", "partial"])
      .not("clinic_patient_id", "is", null),
    orgId,
    skipOrgFilter
  );

  const { data: salesData, error: salesErr } = await salesQ;
  if (salesErr) throw new Error(salesErr.message);

  const sales = (salesData || []) as SaleRow[];
  const saleIds = sales.map((s) => s.id);

  const paymentsBySaleId = new Map<string, PaymentRow[]>();
  for (let i = 0; i < saleIds.length; i += PAYMENT_CHUNK) {
    const chunk = saleIds.slice(i, i + PAYMENT_CHUNK);
    if (chunk.length === 0) continue;
    let payQ = supabase
      .from("payments")
      .select(
        "id, transaction_id, paid_at, amount, payment_status, stay_id, payment_source, source_documents"
      )
      .in("transaction_id", chunk)
      .is("stay_id", null);
    payQ = filterByOrganizationId(payQ, orgId, skipOrgFilter);
    const { data: payRows, error: payErr } = await payQ;
    if (payErr) throw new Error(payErr.message);
    for (const p of (payRows || []) as PaymentRow[]) {
      const sid = p.transaction_id != null ? String(p.transaction_id).trim() : "";
      if (!sid) continue;
      const list = paymentsBySaleId.get(sid) || [];
      list.push(p);
      paymentsBySaleId.set(sid, list);
    }
  }

  let completedCount = 0;
  let salesValue = 0;
  let refundedValue = 0;

  for (const sale of sales) {
    const pays = paymentsBySaleId.get(sale.id) || [];
    if (!isClinicDispensingSale(sale, pays)) continue;

    for (const p of pays) {
      const amt = Number(p.amount ?? 0);
      if (p.payment_status === "completed") {
        completedCount += 1;
        salesValue += amt;
      } else if (p.payment_status === "refunded") {
        refundedValue += amt;
      }
    }
  }

  const { data: creditRows, error: creditErr } = await openCreditQ;
  if (creditErr) throw new Error(creditErr.message);

  const openSales = (creditRows || []) as Array<{ amount_due: number | null; credit_due_date: string | null }>;
  let outstandingCredit = 0;
  let overdueCredit = 0;
  const now = Date.now();
  for (const s of openSales) {
    const due = Number(s.amount_due ?? 0);
    outstandingCredit += due;
    if (s.credit_due_date && new Date(`${s.credit_due_date}T00:00:00`).getTime() < now) {
      overdueCredit += due;
    }
  }

  return {
    completedCount,
    salesValue,
    refundedValue,
    outstandingCredit,
    overdueCredit,
    openCreditSaleCount: openSales.length,
  };
}
