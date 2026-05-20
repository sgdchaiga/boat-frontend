import type { Loan } from "@/types/saccoWorkspace";

export type AmortizationRow = {
  month: number;
  payment: number;
  principal: number;
  interest: number;
  balance: number;
};

/** Monthly instalment (UGX, rounded). Flat = equal principal + equal interest each month. */
export function calculateMonthlyPayment(
  P: number,
  annualRate: number,
  n: number,
  basis: "flat" | "declining"
): number {
  if (n <= 0 || P <= 0) return 0;
  const r = annualRate / 100 / 12;
  if (basis === "flat") {
    const totalInterest = P * (annualRate / 100) * (n / 12);
    return Math.round((P + totalInterest) / n);
  }
  if (r === 0) return Math.round(P / n);
  return Math.round((P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1));
}

/**
 * Full amortization schedule. Flat rate: constant principal and constant interest every month
 * (total interest = P × annual% × tenor in years; each month pays P/n and (total interest)/n).
 * Declining: standard annuity using monthly payment on remaining balance.
 */
export function buildLoanAmortizationSchedule(
  loan: Pick<Loan, "amount" | "interestRate" | "term" | "interestBasis" | "monthlyPayment">
): AmortizationRow[] {
  const P = Math.max(0, loan.amount);
  const n = Math.max(0, Math.floor(loan.term));
  const basis = loan.interestBasis === "flat" ? "flat" : "declining";
  if (n <= 0 || P <= 0) return [];

  const schedule: AmortizationRow[] = [];

  if (basis === "flat") {
    const annual = loan.interestRate;
    const totalInterest = Math.round(P * (annual / 100) * (n / 12));
    const principalEach = Math.floor(P / n);
    const interestEach = Math.floor(totalInterest / n);
    let balance = P;
    for (let month = 1; month <= n; month++) {
      const isLast = month === n;
      const principal = isLast ? balance : principalEach;
      const interest = isLast ? totalInterest - interestEach * (n - 1) : interestEach;
      const payment = principal + interest;
      balance = Math.max(0, balance - principal);
      schedule.push({ month, payment, principal, interest, balance });
    }
    return schedule;
  }

  const annual = loan.interestRate;
  const r = annual / 100 / 12;
  const pmt =
    loan.monthlyPayment > 0
      ? Math.round(loan.monthlyPayment)
      : calculateMonthlyPayment(P, annual, n, "declining");
  let balance = P;

  for (let month = 1; month <= n; month++) {
    const interest = Math.round(balance * r);
    let principal = pmt - interest;
    if (month === n) {
      principal = balance;
    } else if (principal > balance) {
      principal = balance;
    }
    const actualPayment = principal + interest;
    balance = Math.max(0, balance - principal);
    schedule.push({
      month,
      payment: actualPayment,
      principal,
      interest,
      balance,
    });
  }

  return schedule;
}
