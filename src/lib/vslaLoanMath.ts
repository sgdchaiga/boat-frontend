export type VslaLoanCore = {
  principal_amount: number;
  interest_rate_percent: number;
  interest_type?: "flat" | "declining" | null;
  disbursed_on?: string | null;
};

export type VslaLoanRepaymentLike = {
  paid_on?: string | null;
  principal_paid?: number | null;
  interest_paid?: number | null;
  penalty_paid?: number | null;
};

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(`${value}T00:00:00`);
}

export function elapsedMonths(
  disbursedOn: string | null | undefined,
  asOf: Date = new Date(),
): number {
  if (!disbursedOn) return 0;
  const start = toDate(disbursedOn);
  const end = new Date(asOf);
  let months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth());
  if (end.getDate() < start.getDate()) months -= 1;
  return Math.max(0, months);
}

export function computeVslaLoanOutstanding(
  loan: VslaLoanCore,
  repayments: VslaLoanRepaymentLike[],
  asOf: Date = new Date(),
): { outstanding: number; totalDue: number; accruedInterest: number } {
  const principal = Number(loan.principal_amount || 0);
  const rate = Number(loan.interest_rate_percent || 0) / 100;
  const months = elapsedMonths(loan.disbursed_on ?? null, asOf);
  const interestType =
    loan.interest_type === "declining" ? "declining" : "flat";

  const principalPaid = repayments.reduce(
    (s, r) => s + Number(r.principal_paid || 0),
    0,
  );
  const interestPaid = repayments.reduce(
    (s, r) => s + Number(r.interest_paid || 0),
    0,
  );
  const penaltyPaid = repayments.reduce(
    (s, r) => s + Number(r.penalty_paid || 0),
    0,
  );

  const remainingPrincipal = Math.max(0, principal - principalPaid);
  let accruedInterest = 0;

  if (months > 0) {
    if (interestType === "flat") {
      accruedInterest = principal * rate * months;
    } else {
      const groupedPrincipal = new Map<string, number>();
      for (const r of repayments) {
        const day = (r.paid_on ?? "").slice(0, 10);
        if (!day) continue;
        groupedPrincipal.set(
          day,
          (groupedPrincipal.get(day) ?? 0) + Number(r.principal_paid || 0),
        );
      }

      let runningPrincipal = principal;
      const start = toDate(
        loan.disbursed_on ?? new Date().toISOString().slice(0, 10),
      );
      for (let i = 0; i < months; i++) {
        const monthDate = new Date(
          start.getFullYear(),
          start.getMonth() + i + 1,
          start.getDate(),
        );
        accruedInterest += Math.max(0, runningPrincipal) * rate;
        const monthKeyPrefix = monthDate.toISOString().slice(0, 7);
        let paidThisMonth = 0;
        for (const [k, v] of groupedPrincipal.entries()) {
          if (k.startsWith(monthKeyPrefix)) paidThisMonth += v;
        }
        runningPrincipal = Math.max(0, runningPrincipal - paidThisMonth);
      }
    }
  }

  const totalDue = remainingPrincipal + accruedInterest;
  const outstanding = Math.max(0, totalDue - interestPaid - penaltyPaid);
  return { outstanding, totalDue, accruedInterest };
}
