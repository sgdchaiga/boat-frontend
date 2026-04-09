/** Date range used to pull journal activity for a budget. */
export function budgetPeriodRange(b: { start_date: string | null; end_date: string | null }): { from: string; to: string } {
  const today = new Date().toISOString().slice(0, 10);
  if (b.start_date && b.end_date) {
    return { from: b.start_date, to: b.end_date };
  }
  if (b.start_date) {
    return { from: b.start_date, to: today };
  }
  if (b.end_date) {
    const y = new Date(b.end_date).getFullYear();
    return { from: `${y}-01-01`, to: b.end_date };
  }
  const y = new Date().getFullYear();
  return { from: `${y}-01-01`, to: today };
}

/** Signed activity in "budget comparison" terms: expense → debit−credit, income → credit−debit. */
export function netJournalActivity(debit: number, credit: number, accountType: string): number {
  const t = (accountType || "expense").toLowerCase();
  const d = Number(debit) || 0;
  const c = Number(credit) || 0;
  if (t === "income") return c - d;
  if (t === "expense") return d - c;
  return d - c;
}

/** Positive = favorable (under budget for expense, over for income). */
export function budgetVariance(budget: number, actual: number, accountType: string): number {
  const t = (accountType || "expense").toLowerCase();
  if (t === "income") return actual - budget;
  return budget - actual;
}

/** Whole months spanned by [from, to] inclusive (minimum 1). */
export function monthsInclusiveInRange(fromStr: string, toStr: string): number {
  const a = new Date(`${fromStr}T12:00:00`);
  const b = new Date(`${toStr}T12:00:00`);
  const m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1;
  return Math.max(1, m);
}

/**
 * How many billing periods fall inside the budget date range for a given frequency.
 * Used as: budget line amount ≈ quantity × unit_price × this multiplier.
 */
export function frequencyPeriodMultiplier(
  budget: { start_date: string | null; end_date: string | null },
  frequency: string | null | undefined
): number {
  const { from, to } = budgetPeriodRange(budget);
  const months = monthsInclusiveInRange(from, to);
  const f = (frequency || "one_time").toLowerCase().replace(/-/g, "_");
  if (f === "monthly") return months;
  if (f === "quarterly") return Math.max(1, Math.ceil(months / 3));
  if (f === "semi_annual") return Math.max(1, Math.ceil(months / 6));
  if (f === "annual") return Math.max(1, Math.ceil(months / 12));
  return 1;
}
