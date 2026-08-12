import { createJournalEntry, deleteJournalEntryByReference, getDefaultGlAccounts } from "@/lib/journal";
import { supabase } from "@/lib/supabase";
import { businessTodayISO } from "@/lib/timezone";

export async function postPayrollLoanDisbursement(opts: {
  organizationId: string;
  staffUserId: string | null;
  loanId: string;
  staffId: string;
  amount: number;
  totalRepayable?: number;
  reference?: string | null;
}) {
  await deleteJournalEntryByReference("payroll_loan_disbursement", opts.loanId, opts.organizationId);
  const [{ data: settings }, accounts, { data: interestAccounts }] = await Promise.all([
    supabase
      .from("payroll_org_settings")
      .select("staff_loan_receivable_gl_account_id")
      .eq("organization_id", opts.organizationId)
      .maybeSingle(),
    getDefaultGlAccounts(),
    supabase.from("gl_accounts").select("id,account_code,account_name").eq("organization_id", opts.organizationId).eq("is_active", true),
  ]);
  const staffAdvanceGl = settings?.staff_loan_receivable_gl_account_id as string | null | undefined;
  if (!staffAdvanceGl || !accounts.cash) {
    return { ok: false as const, error: "Configure Staff loan receivable and Cash GL accounts before disbursing a payroll loan." };
  }
  const amount = Math.round(Number(opts.amount) * 100) / 100;
  const totalRepayable = Math.max(amount, Math.round(Number(opts.totalRepayable ?? amount) * 100) / 100);
  const interest = Math.round((totalRepayable - amount) * 100) / 100;
  const interestIncomeGl = (interestAccounts || []).find((row: { account_code?: string; account_name?: string }) => row.account_code === "4210" || /interest.*income/i.test(row.account_name || ""))?.id as string | undefined;
  if (interest > 0 && !interestIncomeGl) return { ok: false as const, error: "Configure an Interest Income GL account before saving an interest-bearing staff loan." };
  return createJournalEntry({
    entry_date: businessTodayISO(),
    description: `Staff loan disbursed${opts.reference ? ` — ${opts.reference}` : ""}`,
    reference_type: "payroll_loan_disbursement",
    reference_id: opts.loanId,
    lines: [
      { gl_account_id: staffAdvanceGl, debit: totalRepayable, credit: 0, line_description: "Staff advance and interest receivable", dimensions: { staff_id: opts.staffId } },
      { gl_account_id: accounts.cash, debit: 0, credit: amount, line_description: "Cash paid to staff", dimensions: { staff_id: opts.staffId } },
      ...(interest > 0 ? [{ gl_account_id: interestIncomeGl!, debit: 0, credit: interest, line_description: "Staff loan interest income", dimensions: { staff_id: opts.staffId } }] : []),
    ],
    created_by: opts.staffUserId,
    organizationId: opts.organizationId,
  });
}

export async function cancelPayrollLoanDisbursement(organizationId: string, loanId: string) {
  return deleteJournalEntryByReference("payroll_loan_disbursement", loanId, organizationId);
}
