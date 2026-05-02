import type { CashbookEntry, Loan, Member } from "@/types/saccoWorkspace";

/** Period filter: ISO date yyyy-mm-dd inclusive. */
export type PeriodRange = { from: string; to: string };

function inRange(dateStr: string, range: PeriodRange): boolean {
  const d = dateStr.slice(0, 10);
  return d >= range.from && d <= range.to;
}

function sumDebitCategory(cb: CashbookEntry[], range: PeriodRange, categoryMatch: RegExp): number {
  return cb
    .filter((e) => inRange(e.date, range) && e.category && categoryMatch.test(e.category))
    .reduce((s, e) => s + Number(e.debit || 0), 0);
}

function sumDebitDescription(cb: CashbookEntry[], range: PeriodRange, re: RegExp): number {
  return cb.filter((e) => inRange(e.date, range) && re.test(e.description)).reduce((s, e) => s + Number(e.debit || 0), 0);
}

function sumCreditDescription(cb: CashbookEntry[], range: PeriodRange, re: RegExp): number {
  return cb.filter((e) => inRange(e.date, range) && re.test(e.description)).reduce((s, e) => s + Number(e.credit || 0), 0);
}

export type SaccoRatioSnapshot = {
  periodLabel: string;
  /** Operating self-sufficiency-style: collections ÷ administrative cash outlays (approximation). */
  ossApprox: number | null;
  /** Financial surplus proxy: collections − heuristic opex ratio (not statutory FSS). */
  surplusToDepositsApprox: number | null;
  /** Gross loan portfolio / total savings liabilities (coverage of deposits by loans). */
  loansToSavingsRatio: number | null;
  /** Cashbook “liquidity” proxy: net member receipts in period / savings stock. */
  liquidityProxy: number | null;
  /** PAR proxy: defaulted + written-off remaining as % of disbursed outstanding. */
  parProxyPercent: number | null;
  /** Portfolio at risk (strict): written-off remaining + defaulted balance / portfolio. */
  portfolioYieldProxy: number | null;
  detail: Record<string, string>;
};

/** Compute illustrative ratios from SACCO workspace data (cashbook taxonomy may vary by org). */
export function computeSaccoPerformanceRatios(
  loans: Loan[],
  members: Member[],
  cashbook: CashbookEntry[],
  range: PeriodRange
): SaccoRatioSnapshot {
  const disbursed = loans.filter(
    (l) =>
      l.status === "disbursed" ||
      l.status === "defaulted" ||
      (l.status === "written_off" && l.balance > 0)
  );
  const portfolioOutstanding = disbursed.reduce((s, l) => s + Math.max(0, l.balance), 0);
  const woRemaining = loans.reduce((s, l) => s + Math.max(0, l.writtenOffRemaining ?? 0), 0);
  const defaultedBal = loans.filter((l) => l.status === "defaulted").reduce((s, l) => s + Math.max(0, l.balance), 0);

  const savingsDepositStock = members.reduce((s, m) => s + Math.max(0, m.savingsBalance), 0);

  const adminOpexGuess = Math.max(
    1,
    sumDebitCategory(cashbook, range, /admin|salary|wage|opex|op\.?\s*expense/i)
      + sumDebitDescription(cashbook, range, /administration|utilities|staff|salary/i)
  );

  const loanCollectionsGuess = sumCreditDescription(
    cashbook,
    range,
    /loan\s*repayment|repayment.*loan|collection.*loan/i
  );
  const totalCreditsPeriod = cashbook.filter((e) => inRange(e.date, range)).reduce((s, e) => s + Number(e.credit || 0), 0);

  const collectionsForOss = Math.max(loanCollectionsGuess, totalCreditsPeriod * 0.35);

  const ossApprox = adminOpexGuess > 0 ? collectionsForOss / adminOpexGuess : null;

  const surplusToDepositsApprox =
    savingsDepositStock > 0 ? (collectionsForOss - adminOpexGuess * 0.5) / savingsDepositStock : null;

  const loansToSavingsRatio =
    savingsDepositStock > 0 ? portfolioOutstanding / savingsDepositStock : portfolioOutstanding > 0 ? null : null;

  const liquidityProxy =
    savingsDepositStock > 0 ? totalCreditsPeriod / savingsDepositStock : totalCreditsPeriod > 0 ? null : null;

  const parDenom = portfolioOutstanding + woRemaining + 1e-6;
  const parProxyPercent = ((defaultedBal + woRemaining) / parDenom) * 100;

  const portfolioYieldProxy =
    portfolioOutstanding > 0 ? (loanCollectionsGuess / portfolioOutstanding) * 100 : null;

  return {
    periodLabel: `${range.from} → ${range.to}`,
    ossApprox,
    surplusToDepositsApprox,
    loansToSavingsRatio,
    liquidityProxy,
    parProxyPercent: Number.isFinite(parProxyPercent) ? parProxyPercent : null,
    portfolioYieldProxy,
    detail: {
      portfolioOutstanding: String(Math.round(portfolioOutstanding)),
      savingsDepositStock: String(Math.round(savingsDepositStock)),
      woRemaining: String(Math.round(woRemaining)),
      cashbookCreditsPeriod: String(Math.round(totalCreditsPeriod)),
      adminOpexGuess: String(Math.round(adminOpexGuess)),
    },
  };
}
