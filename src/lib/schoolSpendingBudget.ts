export type SchoolSpendingBudget = {
  id: string; name: string; start_date: string | null; end_date: string | null;
  financial_year: number | null; period_mode: string; status: string | null; is_active: boolean;
};

/** Explicit dates win. Annual budgets with omitted dates use their financial year. */
export function schoolSpendingPeriod(budget: SchoolSpendingBudget): { from: string; to: string } | null {
  const annual = ['annual', 'annual_terms'].includes(budget.period_mode);
  const year = budget.financial_year;
  const from = budget.start_date || (annual && year ? `${year}-01-01` : null);
  const to = budget.end_date || (annual && year ? `${year}-12-31` : null);
  return from && to && from <= to ? { from, to } : null;
}

export function schoolBudgetCoversDate(budget: SchoolSpendingBudget, date: string): boolean {
  const period = schoolSpendingPeriod(budget);
  return Boolean(period && period.from <= date && date <= period.to);
}

export function schoolBudgetIsSpendable(budget: SchoolSpendingBudget): boolean {
  return budget.status ? budget.status === 'active' : budget.is_active;
}

export function schoolBudgetUnavailableMessage(budgets: SchoolSpendingBudget[], date: string): string {
  const covering = budgets.filter(budget => schoolBudgetCoversDate(budget, date));
  if (covering.length) {
    return `Budget covering ${date}: ${covering.map(b => `${b.name} (${b.status || (b.is_active ? 'active' : 'inactive')})`).join('; ')}. Complete its approval workflow and activate it in Budget formulation before posting spending.`;
  }
  return `No budget covers ${date}. In Budget formulation, check the annual budget's financial year and date range, then complete approval and activation. A separate term budget is not required for an annual budget.`;
}

/** Parent amounts roll up their children; including both doubles the spending limit. */
export function schoolBudgetLeafLines<T extends { id: string; parent_line_id: string | null }>(lines: T[]): T[] {
  const parents = new Set(lines.map(line => line.parent_line_id).filter(Boolean));
  return lines.filter(line => !parents.has(line.id));
}
