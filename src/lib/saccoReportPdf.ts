/**
 * PDF exports for SACCO module reports (teller + portfolio + statements).
 */
import { exportAccountingPdf } from "@/lib/accountingReportExport";
import type { TellerReportTable } from "@/lib/saccoTellerDb";
import type { CashbookEntry, FixedDeposit, Loan, Member } from "@/types/saccoWorkspace";
import {
  generateCashbookReport,
  generateFixedDepositReport,
  generateLoanPortfolioReport,
  generateMemberSavingsReport,
} from "@/lib/pdfGenerator";
import type { SaccoReportBranding } from "@/lib/pdfGenerator";
import { supabase } from "@/lib/supabase";

async function reportBranding(organizationId?: string | null): Promise<SaccoReportBranding> {
  if (!organizationId) return {};
  const { data } = await supabase.from("organizations").select("name,address,logo_url").eq("id", organizationId).maybeSingle();
  const row = data as { name?: string | null; address?: string | null; logo_url?: string | null } | null;
  let logoDataUrl: string | null = null;
  if (row?.logo_url) {
    try {
      const blob = await (await fetch(row.logo_url)).blob();
      logoDataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
    } catch { logoDataUrl = null; }
  }
  return { name: row?.name, address: row?.address, logoDataUrl };
}

export function downloadTellerReportPdf(table: TellerReportTable, filename: string, companyName?: string): void {
  exportAccountingPdf({
    title: table.title,
    subtitle: table.subtitle,
    filename,
    companyName,
    sections: [{ title: "Detail", head: table.head, body: table.rows }],
    footerLines: table.summaryLines,
  });
}

export async function downloadLoanReportPdf(
  reportTab: "summary" | "aging" | "disbursement" | "collection",
  loans: Loan[],
  options: { dateFrom: string; dateTo: string; companyName?: string; organizationId?: string | null }
): Promise<void> {
  if (reportTab === "summary") {
    generateLoanPortfolioReport(
      loans.map((l) => ({
        id: l.id,
        status: l.status,
        amount: l.amount,
        balance: l.balance,
        paidAmount: l.paidAmount,
        loanType: l.loanType,
        interestRate: l.interestRate,
        memberName: l.memberName,
        term: l.term,
        monthlyPayment: l.monthlyPayment,
      })),
      options.dateFrom,
      options.dateTo, await reportBranding(options.organizationId)
    );
    return;
  }

  const active = loans.filter((l) => l.status === "disbursed");
  const disbursed = loans.filter((l) => ["disbursed", "closed"].includes(l.status));

  if (reportTab === "disbursement") {
    const rows = disbursed
      .filter((l) => l.disbursementDate)
      .map((l) => [
        l.disbursementDate ?? "",
        l.memberName,
        l.loanType,
        `UGX ${Math.round(l.amount).toLocaleString("en-UG")}`,
        l.status,
      ]);
    exportAccountingPdf({
      title: "Loan disbursement report",
      subtitle: `${options.dateFrom} to ${options.dateTo}`,
      filename: `sacco_loan_disbursements_${options.dateTo}`,
      companyName: options.companyName,
      sections: [{ title: "Disbursements", head: ["Date", "Member", "Type", "Amount", "Status"], body: rows }],
    });
    return;
  }

  if (reportTab === "collection") {
    const rows = active.map((l) => [
      l.memberName,
      l.loanType,
      `UGX ${Math.round(l.balance).toLocaleString("en-UG")}`,
      `UGX ${Math.round(l.paidAmount).toLocaleString("en-UG")}`,
      l.lastPaymentDate ?? "—",
    ]);
    exportAccountingPdf({
      title: "Loan collection report",
      subtitle: `Outstanding portfolio as at ${options.dateTo}`,
      filename: `sacco_loan_collections_${options.dateTo}`,
      companyName: options.companyName,
      sections: [{ title: "Collections", head: ["Member", "Type", "Balance", "Paid", "Last payment"], body: rows }],
    });
    return;
  }

  // aging
  const buckets = [
    "Current (0–30 days)",
    "31–60 days",
    "61–90 days",
    "91–180 days",
    "181–365 days",
    "Over 365 days",
  ];
  const bucketRows = buckets.map((bracket, idx) => {
    const bucketLoans = active.filter((l) => {
      const ref = l.lastPaymentDate || l.disbursementDate || l.applicationDate;
      const days = ref
        ? Math.max(
            0,
            Math.floor((Date.now() - new Date(ref.includes("T") ? ref : `${ref}T12:00:00`).getTime()) / 86_400_000)
          )
        : 0;
      if (idx === 0) return days <= 30;
      if (idx === 1) return days > 30 && days <= 60;
      if (idx === 2) return days > 60 && days <= 90;
      if (idx === 3) return days > 90 && days <= 180;
      if (idx === 4) return days > 180 && days <= 365;
      return days > 365;
    });
    const amount = bucketLoans.reduce((s, l) => s + l.balance, 0);
    return [bracket, String(bucketLoans.length), `UGX ${Math.round(amount).toLocaleString("en-UG")}`];
  });
  exportAccountingPdf({
    title: "Loan aging analysis",
    subtitle: `As at ${options.dateTo}`,
    filename: `sacco_loan_aging_${options.dateTo}`,
    companyName: options.companyName,
    sections: [{ title: "Aging buckets", head: ["Bracket", "Loans", "Outstanding"], body: bucketRows }],
  });
}

export async function downloadMemberSavingsPdf(
  members: Member[],
  dateFrom: string,
  dateTo: string, organizationId?: string | null
): Promise<void> {
  generateMemberSavingsReport(
    members.map((m) => ({
      accountNumber: m.accountNumber,
      name: m.name,
      gender: "",
      joinDate: m.joinDate,
      savingsBalance: m.savingsBalance,
      sharesBalance: m.sharesBalance,
      status: m.status,
    })),
    dateFrom,
    dateTo, await reportBranding(organizationId)
  );
}

export async function downloadFixedDepositsPdf(
  fixedDeposits: FixedDeposit[],
  dateFrom: string,
  dateTo: string, organizationId?: string | null
): Promise<void> {
  generateFixedDepositReport(fixedDeposits, dateFrom, dateTo, await reportBranding(organizationId));
}

export async function downloadCashbookPdf(
  cashbook: CashbookEntry[],
  dateFrom: string,
  dateTo: string, organizationId?: string | null
): Promise<void> {
  generateCashbookReport(
    cashbook.map((e) => ({
      id: e.id,
      date: e.date,
      description: e.description,
      reference: e.reference ?? "",
      category: e.category ?? "",
      memberName: e.memberName ?? null,
      debit: e.debit,
      credit: e.credit,
      balance: e.balance,
    })),
    dateFrom,
    dateTo, await reportBranding(organizationId)
  );
}

export function downloadSaccoTablePdf(options: {
  title: string;
  subtitle?: string;
  filename: string;
  head: string[];
  rows: (string | number)[][];
  companyName?: string;
  footerLines?: string[];
}): void {
  exportAccountingPdf({
    title: options.title,
    subtitle: options.subtitle,
    filename: options.filename,
    companyName: options.companyName,
    sections: [{ title: "Report", head: options.head, body: options.rows }],
    footerLines: options.footerLines,
  });
}
