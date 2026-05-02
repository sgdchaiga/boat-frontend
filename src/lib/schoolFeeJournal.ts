import {
  deleteJournalEntryByReference,
  createJournalForSchoolInvoiceAccrual,
  createJournalForSchoolFeePayment,
} from "./journal";
import { fetchJournalGlSettings } from "./journalAccountSettings";
import { businessTodayISO } from "./timezone";

export type SchoolAccountingBasis = "accrual" | "cash";

export async function getSchoolAccountingBasis(organizationId: string): Promise<SchoolAccountingBasis> {
  const row = await fetchJournalGlSettings(organizationId);
  return row?.school_accounting_basis === "cash" ? "cash" : "accrual";
}

/** Idempotent GL sync for a student invoice (accrual only). Deletes prior school_invoice journal for this id. */
export async function syncStudentInvoiceAccounting(opts: {
  organizationId: string;
  staffUserId: string | null;
  invoice: {
    id: string;
    student_id: string;
    invoice_number: string;
    total_due: number;
    status: string;
    academic_year?: string | null;
    term_name?: string | null;
  };
}): Promise<{ journalMessage?: string }> {
  const { organizationId, staffUserId, invoice } = opts;
  const basis = await getSchoolAccountingBasis(organizationId);
  await deleteJournalEntryByReference("school_invoice", invoice.id);
  if (basis !== "accrual") {
    return {};
  }
  const st = String(invoice.status || "").toLowerCase();
  if (st === "draft" || st === "cancelled") {
    return {};
  }
  const amount = Math.round(Number(invoice.total_due) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) {
    return {};
  }
  const desc = [invoice.invoice_number, invoice.academic_year, invoice.term_name].filter(Boolean).join(" · ");
  const jr = await createJournalForSchoolInvoiceAccrual(
    invoice.id,
    amount,
    desc || invoice.invoice_number,
    businessTodayISO(),
    staffUserId,
    organizationId,
    invoice.student_id
  );
  if (!jr.ok) {
    return { journalMessage: jr.error };
  }
  return {};
}

export async function postSchoolFeePaymentAccounting(opts: {
  organizationId: string;
  staffUserId: string | null;
  paymentId: string;
  amount: number;
  method: string;
  paidAt: string;
  studentId: string;
}): Promise<{ journalMessage?: string }> {
  const { organizationId, staffUserId, paymentId, amount, method, paidAt, studentId } = opts;
  const basis = await getSchoolAccountingBasis(organizationId);
  await deleteJournalEntryByReference("school_payment", paymentId);
  const amt = Math.round(Number(amount) * 100) / 100;
  if (!Number.isFinite(amt) || amt <= 0) {
    return {};
  }
  const jr = await createJournalForSchoolFeePayment(
    paymentId,
    amt,
    method,
    paidAt,
    staffUserId,
    organizationId,
    basis,
    studentId
  );
  if (!jr.ok) {
    return { journalMessage: jr.error };
  }
  return {};
}
