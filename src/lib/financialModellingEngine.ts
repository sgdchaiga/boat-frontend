export type ModelScenario = "base" | "optimistic" | "conservative";

export type FinancialModelInputs = {
  years: number;
  startingCustomers: number;
  annualCustomerGrowth: number;
  annualPrice: number;
  churnRate: number;
  grossMargin: number;
  annualPayroll: number;
  annualOverheads: number;
  opexInflation: number;
  capex: number;
  fundingRequired: number;
  debtShare: number;
  interestRate: number;
  loanTerm: number;
  taxRate: number;
  receivableDays: number;
  payableDays: number;
  inventoryDays?: number;
  repaymentMethod?: "equal-principal" | "annuity" | "interest-only" | "balloon";
  gracePeriod?: number;
  balloonPercent?: number;
};

export type ProjectionYear = {
  year: number; customers: number; revenue: number; costOfSales: number; grossProfit: number;
  operatingExpenses: number; ebitda: number; depreciation: number; ebit: number; interest: number;
  tax: number; netProfit: number; operatingCashFlow: number; closingCash: number; debtBalance: number;
  dscr: number; ebitdaMargin: number;
  receivablesBalance?: number; inventoryBalance?: number; payablesBalance?: number;
  capexPurchases?: number; netPpeBalance?: number; capitalAllowance?: number;
};

const scenarioFactor = {
  base: { growth: 1, price: 1, costs: 1 },
  optimistic: { growth: 1.2, price: 1.05, costs: .97 },
  conservative: { growth: .72, price: .95, costs: 1.08 },
};

export function calculateFinancialModel(
  input: FinancialModelInputs,
  scenario: ModelScenario,
  customerOverrides: Partial<Record<number, number>> = {},
  payrollOverrides: Partial<Record<number, number>> = {},
): ProjectionYear[] {
  const f = scenarioFactor[scenario];
  const debt = input.fundingRequired * input.debtShare / 100;
  const annualPrincipal = input.loanTerm > 0 ? debt / input.loanTerm : 0;
  const depreciation = input.capex / Math.max(input.years, 5);
  let customers = input.startingCustomers;
  let cash = input.fundingRequired - input.capex;
  let debtBalance = debt;

  return Array.from({ length: input.years }, (_, i) => {
    const year = i + 1;
    const explicitCustomers = customerOverrides[year];
    if (explicitCustomers != null && Number.isFinite(explicitCustomers) && explicitCustomers >= 0) {
      customers = explicitCustomers;
    } else if (year > 1) {
      customers *= 1 + (input.annualCustomerGrowth * f.growth - input.churnRate) / 100;
    }
    const revenue = customers * input.annualPrice * f.price;
    const costOfSales = revenue * (1 - input.grossMargin / 100);
    const grossProfit = revenue - costOfSales;
    const payroll = payrollOverrides[year] ?? input.annualPayroll * Math.pow(1 + input.opexInflation / 100, i);
    const overheads = input.annualOverheads * Math.pow(1 + input.opexInflation / 100, i);
    const operatingExpenses = (payroll + overheads) * f.costs;
    const ebitda = grossProfit - operatingExpenses;
    const ebit = ebitda - depreciation;
    const interest = debtBalance * input.interestRate / 100;
    const tax = Math.max(0, ebit - interest) * input.taxRate / 100;
    const netProfit = ebit - interest - tax;
    const workingCapitalMovement = revenue * (input.receivableDays / 365) - costOfSales * (input.payableDays / 365);
    const principal = Math.min(debtBalance, annualPrincipal);
    const operatingCashFlow = netProfit + depreciation - workingCapitalMovement;
    cash += operatingCashFlow - principal;
    debtBalance -= principal;
    const debtService = principal + interest;
    return { year, customers: Math.round(customers), revenue, costOfSales, grossProfit, operatingExpenses,
      ebitda, depreciation, ebit, interest, tax, netProfit, operatingCashFlow, closingCash: cash, debtBalance,
      dscr: debtService > 0 ? (ebitda - tax) / debtService : 0, ebitdaMargin: revenue ? ebitda / revenue * 100 : 0 };
  });
}

export function validateFinancialModel(input: FinancialModelInputs, rows: ProjectionYear[], allocatedFunding: number) {
  const warnings: { level: "critical" | "warning" | "good"; title: string; detail: string }[] = [];
  const gap = input.fundingRequired - allocatedFunding;
  if (Math.abs(gap) > 1) warnings.push({ level: "critical", title: "Funding allocation does not reconcile", detail: `${Math.abs(gap).toLocaleString()} remains ${gap > 0 ? "unallocated" : "over-allocated"}.` });
  if (rows.some(r => r.closingCash < 0)) warnings.push({ level: "critical", title: "Negative cash balance", detail: "At least one projection year needs additional funding or lower spending." });
  if (rows.some(r => r.dscr > 0 && r.dscr < 1.2)) warnings.push({ level: "warning", title: "Debt service pressure", detail: "DSCR falls below the lender comfort threshold of 1.20x." });
  if (rows.some(r => r.ebitdaMargin > 60)) warnings.push({ level: "warning", title: "High EBITDA margin", detail: "Confirm that support, delivery and growth costs are fully captured." });
  if (!warnings.length) warnings.push({ level: "good", title: "Core checks passed", detail: "Funding, liquidity and debt-service assumptions are internally consistent." });
  return warnings;
}
