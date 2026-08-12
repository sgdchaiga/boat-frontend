import { roundMoney } from "@/lib/payrollCalculation";

export type PayrollLoanInterestMethod = "flat" | "declining";
export type PayrollLoanScheduleRow = { installment: number; openingBalance: number; principal: number; interest: number; payment: number; closingBalance: number };

export function buildPayrollLoanSchedule(principal: number, annualRatePct: number, termMonths: number, method: PayrollLoanInterestMethod = "flat"): PayrollLoanScheduleRow[] {
  const p = Math.max(0, Number(principal) || 0);
  const months = Math.max(1, Math.trunc(Number(termMonths) || 1));
  const monthlyRate = Math.max(0, Number(annualRatePct) || 0) / 1200;
  const principalPart = p / months;
  const flatInterest = p * monthlyRate;
  const rows: PayrollLoanScheduleRow[] = [];
  let balance = p;
  for (let index = 1; index <= months; index += 1) {
    const openingBalance = balance;
    const principalPayment = index === months ? balance : Math.min(balance, principalPart);
    const interest = method === "declining" ? openingBalance * monthlyRate : flatInterest;
    balance = Math.max(0, openingBalance - principalPayment);
    rows.push({ installment: index, openingBalance: roundMoney(openingBalance), principal: roundMoney(principalPayment), interest: roundMoney(interest), payment: roundMoney(principalPayment + interest), closingBalance: roundMoney(balance) });
  }
  return rows;
}

export function payrollLoanTotalRepayable(principal: number, annualRatePct: number, termMonths: number, method: PayrollLoanInterestMethod = "flat") {
  return roundMoney(buildPayrollLoanSchedule(principal, annualRatePct, termMonths, method).reduce((sum, row) => sum + row.payment, 0));
}
