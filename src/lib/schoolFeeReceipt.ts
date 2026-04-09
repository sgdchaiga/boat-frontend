import { jsPDF } from "jspdf";
import { supabase } from "@/lib/supabase";
import { APP_SHORT_NAME } from "@/constants/branding";
import { downloadCsv } from "@/lib/accountingReportExport";

export type SchoolFeeReceiptDetail = {
  receipt_number: string;
  issued_at: string;
  orgName: string | null;
  /** Campus or mailing address; optional on organizations. */
  orgAddress: string | null;
  studentLabel: string;
  amount: number;
  method: string;
  reference: string | null;
  paid_at: string;
};

type PaymentFields = {
  amount: number;
  method: string;
  reference: string | null;
  paid_at: string;
};

/** Build receipt preview payload from an in-memory payment row (fee payments list). */
export function schoolFeeReceiptDetailFromPayment(
  payment: PaymentFields,
  receipt_number: string,
  issued_at: string,
  studentLabel: string,
  orgName: string | null,
  orgAddress: string | null
): SchoolFeeReceiptDetail {
  return {
    receipt_number,
    issued_at,
    orgName,
    orgAddress,
    studentLabel,
    amount: Number(payment.amount),
    method: payment.method,
    reference: payment.reference,
    paid_at: payment.paid_at,
  };
}

function methodLabel(method: string): string {
  return method.replace(/_/g, " ");
}

export function downloadSchoolFeeReceiptPdf(d: SchoolFeeReceiptDetail): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  /** Frame sized so two receipts fit on one A4 sheet (matches print preview). */
  const frameX = 14;
  const frameY = 14;
  const frameW = 182;
  const frameH = 128;
  const pad = 5;
  const innerLeft = frameX + pad;
  const textWidth = frameW - pad * 2;
  const valueCol = 58;
  const valueW = frameX + frameW - valueCol - pad;
  const footerY = frameY + frameH - 4;

  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.45);
  doc.rect(frameX, frameY, frameW, frameH);

  let y = frameY + pad + 5;
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 0, 0);
  const schoolTitle = doc.splitTextToSize(d.orgName ?? "—", textWidth);
  doc.text(schoolTitle, innerLeft, y);
  y += schoolTitle.length * 5 + 1;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(75, 75, 75);
  if (d.orgAddress?.trim()) {
    const addrLines = doc.splitTextToSize(d.orgAddress.trim(), textWidth);
    doc.text(addrLines, innerLeft, y);
    y += addrLines.length * 3.5 + 3;
  } else {
    y += 2;
  }
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Fee payment receipt", innerLeft, y);
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const rows: [string, string][] = [
    ["Receipt #", d.receipt_number],
    ["Student", d.studentLabel],
    ["Amount", String(d.amount)],
    ["Method", methodLabel(d.method)],
    ["Reference", d.reference ?? "—"],
    ["Paid", new Date(d.paid_at).toLocaleString()],
    ["Issued", new Date(d.issued_at).toLocaleString()],
  ];
  for (const [k, v] of rows) {
    doc.text(k, innerLeft, y);
    const lines = doc.splitTextToSize(v, valueW);
    doc.text(lines, valueCol, y);
    y += Math.max(5.5, lines.length * 4);
  }
  doc.setFontSize(6.5);
  doc.setTextColor(140, 140, 140);
  doc.setFont("helvetica", "normal");
  doc.text(`Powered by ${APP_SHORT_NAME}`, innerLeft, footerY);
  const safeName = d.receipt_number.replace(/[^\w.-]+/g, "_");
  doc.save(`receipt-${safeName}.pdf`);
}

export function downloadSchoolFeeReceiptExcel(d: SchoolFeeReceiptDetail): void {
  const safeName = d.receipt_number.replace(/[^\w.-]+/g, "_");
  downloadCsv(`receipt-${safeName}`, [
    ["Field", "Value"],
    ["School", d.orgName ?? ""],
    ["Address", d.orgAddress ?? ""],
    ["Receipt #", d.receipt_number],
    ["Student", d.studentLabel],
    ["Amount", d.amount],
    ["Method", methodLabel(d.method)],
    ["Reference", d.reference ?? ""],
    ["Paid", new Date(d.paid_at).toLocaleString()],
    ["Issued", new Date(d.issued_at).toLocaleString()],
  ]);
}

export async function loadSchoolFeeReceiptDetail(
  receiptId: string,
  orgId: string
): Promise<{ detail: SchoolFeeReceiptDetail } | { error: string }> {
  const { data: rec, error: rErr } = await supabase
    .from("school_receipts")
    .select("receipt_number,issued_at,school_payment_id")
    .eq("id", receiptId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (rErr) return { error: rErr.message };
  if (!rec) return { error: "Receipt not found." };

  const { data: pay, error: pErr } = await supabase
    .from("school_payments")
    .select("amount,method,reference,paid_at,student_id")
    .eq("id", rec.school_payment_id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (pErr) return { error: pErr.message };
  if (!pay) return { error: "Payment not found." };

  const { data: st } = await supabase
    .from("students")
    .select("first_name,last_name,admission_number")
    .eq("id", pay.student_id)
    .maybeSingle();
  const studentLabel = st
    ? `${st.admission_number} — ${st.first_name} ${st.last_name}`
    : pay.student_id;

  const { data: org } = await supabase.from("organizations").select("name,address").eq("id", orgId).maybeSingle();

  const orgRow = org as { name?: string; address?: string | null } | null;

  return {
    detail: {
      receipt_number: rec.receipt_number,
      issued_at: rec.issued_at,
      orgName: orgRow?.name ?? null,
      orgAddress: orgRow?.address?.trim() ? orgRow.address : null,
      studentLabel,
      amount: Number(pay.amount),
      method: pay.method,
      reference: pay.reference,
      paid_at: pay.paid_at,
    },
  };
}
