import type { StatementYear } from "@/lib/phase1FinancialEngine";
import type { ProjectProjection } from "@/lib/projectPortfolioEngine";

export type ModelBudgetLineKind = "income" | "expense" | "asset";

export type ModelBudgetLine = {
  key: string;
  label: string;
  amount: number;
  kind: ModelBudgetLineKind;
  glAccountId: string | null;
};

export type BudgetGlAccount = {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
};

const cleanAmount = (value: number) => Math.max(0, Math.round((Number(value) || 0) * 100) / 100);

export function buildModelBudgetLines(
  statement: StatementYear,
  projectRows: ProjectProjection[] = [],
  capitalPurchases = 0
): ModelBudgetLine[] {
  const rowsForYear = projectRows.filter(row => row.year === statement.year && (row.revenue > 0 || row.directCosts > 0 || row.fixedCosts > 0));
  const lines: ModelBudgetLine[] = [];
  if (rowsForYear.length) {
    for (const row of rowsForYear) {
      if (row.revenue > 0) lines.push({ key: `project-${row.projectId}-revenue`, label: `${row.name} revenue`, amount: cleanAmount(row.revenue), kind: "income", glAccountId: null });
      if (row.directCosts > 0) lines.push({ key: `project-${row.projectId}-direct-costs`, label: `${row.name} direct costs`, amount: cleanAmount(row.directCosts), kind: "expense", glAccountId: null });
      if (row.fixedCosts > 0) lines.push({ key: `project-${row.projectId}-fixed-costs`, label: `${row.name} fixed costs`, amount: cleanAmount(row.fixedCosts), kind: "expense", glAccountId: null });
    }
    const projectFixedCosts = rowsForYear.reduce((sum, row) => sum + row.fixedCosts, 0);
    const centralOperatingExpenses = cleanAmount(statement.operatingExpenses - projectFixedCosts);
    if (centralOperatingExpenses > 0) lines.push({ key: "central-operating-expenses", label: "Central operating expenses", amount: centralOperatingExpenses, kind: "expense", glAccountId: null });
  } else {
    if (statement.revenue > 0) lines.push({ key: "revenue", label: "Operating revenue", amount: cleanAmount(statement.revenue), kind: "income", glAccountId: null });
    if (statement.costOfSales > 0) lines.push({ key: "cost-of-sales", label: "Cost of sales", amount: cleanAmount(statement.costOfSales), kind: "expense", glAccountId: null });
    if (statement.operatingExpenses > 0) lines.push({ key: "operating-expenses", label: "Operating expenses", amount: cleanAmount(statement.operatingExpenses), kind: "expense", glAccountId: null });
  }
  if (statement.depreciation > 0) lines.push({ key: "depreciation", label: "Depreciation", amount: cleanAmount(statement.depreciation), kind: "expense", glAccountId: null });
  if (statement.interest > 0) lines.push({ key: "finance-costs", label: "Finance costs", amount: cleanAmount(statement.interest), kind: "expense", glAccountId: null });
  if (statement.tax > 0) lines.push({ key: "income-tax", label: "Income tax", amount: cleanAmount(statement.tax), kind: "expense", glAccountId: null });
  if (capitalPurchases > 0) lines.push({ key: "capital-expenditure", label: "Capital expenditure", amount: cleanAmount(capitalPurchases), kind: "asset", glAccountId: null });
  return lines;
}

export function suggestBudgetGlAccount(line: ModelBudgetLine, accounts: BudgetGlAccount[]): string | null {
  const compatible = accounts.filter(account => {
    const type = account.account_type.toLowerCase();
    if (line.kind === "income") return ["income", "revenue"].includes(type);
    if (line.kind === "asset") return type === "asset";
    return ["expense", "cost of sales", "cost_of_sales"].includes(type);
  });
  const words = line.label.toLowerCase().split(/\W+/).filter(word => word.length > 3);
  const scored = compatible.map(account => ({
    id: account.id,
    score: words.reduce((score, word) => score + (account.account_name.toLowerCase().includes(word) ? 1 : 0), 0),
  })).sort((a, b) => b.score - a.score);
  return scored[0]?.score ? scored[0].id : compatible.length === 1 ? compatible[0].id : null;
}
