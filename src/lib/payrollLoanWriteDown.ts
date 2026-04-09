import { supabase } from "@/lib/supabase";
import { roundMoney } from "@/lib/payrollCalculation";

export type PayrollLoanRow = {
  id: string;
  staff_id: string;
  installment_amount: number;
  balance_remaining: number;
  is_active: boolean;
  created_at: string;
};

/** Same allocation order as payroll calculation: active loans per staff, oldest first. */
export function getLoanAllocationsForStaff(staffId: string, loans: PayrollLoanRow[]): { loanId: string; amount: number }[] {
  const mine = loans
    .filter((l) => l.staff_id === staffId && l.is_active)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const out: { loanId: string; amount: number }[] = [];
  for (const l of mine) {
    const d = Math.min(Number(l.installment_amount), Number(l.balance_remaining));
    if (d > 0) out.push({ loanId: l.id, amount: roundMoney(d) });
  }
  return out;
}

export function computeLoanDeductionForStaff(staffId: string, loans: PayrollLoanRow[]): number {
  return roundMoney(getLoanAllocationsForStaff(staffId, loans).reduce((s, a) => s + a.amount, 0));
}

/**
 * After a payroll run is posted to the GL, reduce each loan balance by the same amounts used in the payslip line.
 */
export async function applyLoanWriteDownsAfterPayrollPost(
  organizationId: string,
  lines: { staff_id: string; loan_deduction: number }[]
): Promise<{ error: string | null }> {
  const { data: allLoans, error: loadErr } = await supabase
    .from("payroll_loans")
    .select("id,staff_id,installment_amount,balance_remaining,is_active,created_at")
    .eq("organization_id", organizationId);
  if (loadErr) return { error: loadErr.message };
  let loans = (allLoans as PayrollLoanRow[]) || [];

  for (const line of lines) {
    if (line.loan_deduction <= 0) continue;
    const allocs = getLoanAllocationsForStaff(line.staff_id, loans);
    const sum = roundMoney(allocs.reduce((s, a) => s + a.amount, 0));
    if (Math.abs(sum - line.loan_deduction) > 0.05) {
      return {
        error: `Loan recovery (${sum}) does not match payslip (${line.loan_deduction}) for a staff member. Recalculate payroll, then post again.`,
      };
    }
    for (const a of allocs) {
      const loan = loans.find((l) => l.id === a.loanId);
      if (!loan) continue;
      const newBal = roundMoney(Math.max(0, Number(loan.balance_remaining) - a.amount));
      const { error } = await supabase
        .from("payroll_loans")
        .update({ balance_remaining: newBal, is_active: newBal > 0.01 })
        .eq("id", a.loanId);
      if (error) return { error: error.message };
      loan.balance_remaining = newBal;
      loan.is_active = newBal > 0.01;
    }
  }
  return { error: null };
}
