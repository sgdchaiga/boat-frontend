import type { FinancialModelInputs, ProjectionYear } from "@/lib/financialModellingEngine";

export type StatementYear = {
  year: number; revenue: number; costOfSales: number; grossProfit: number; operatingExpenses: number;
  ebitda: number; depreciation: number; ebit: number; interest: number; tax: number; netProfit: number;
  receivables: number; inventory: number; cash: number; netPpe: number; totalAssets: number; payables: number; debt: number;
  totalLiabilities: number; contributedCapital: number; retainedEarnings: number; equity: number;
  totalLiabilitiesAndEquity: number; balanceCheck: number;
  operatingCashFlow: number; investingCashFlow: number; financingCashFlow: number; netCashMovement: number;
  openingCash: number; closingCash: number; currentRatio: number; debtToEquity: number; interestCover: number; dscr: number;
  quickRatio: number; cashRatio: number; grossMargin: number; ebitdaMargin: number; operatingMargin: number;
  netMargin: number; returnOnAssets: number; returnOnEquity: number; returnOnCapitalEmployed: number;
  assetTurnover: number; debtToEbitda: number; debtRatio: number; gearing: number;
};

export type LoanScheduleYear = { year: number; openingBalance: number; principal: number; interest: number; debtService: number; closingBalance: number };

export function buildLoanSchedule(input: FinancialModelInputs): LoanScheduleYear[] {
  const originalDebt = input.fundingRequired * input.debtShare / 100;
  const term = Math.max(1, Math.round(input.loanTerm));
  const grace = Math.min(term - 1, Math.max(0, Math.round(input.gracePeriod ?? 0)));
  const repaymentYears = Math.max(1, term - grace);
  const method = input.repaymentMethod ?? "equal-principal";
  const rate = input.interestRate / 100;
  const balloon = method === "balloon" ? originalDebt * Math.min(100, Math.max(0, input.balloonPercent ?? 30)) / 100 : 0;
  const amortisingDebt = originalDebt - balloon;
  const annuity = rate ? amortisingDebt * rate / (1 - Math.pow(1 + rate, -repaymentYears)) : amortisingDebt / repaymentYears;
  let balance = originalDebt;
  return Array.from({ length: input.years }, (_, index) => {
    const year = index + 1, openingBalance = balance;
    const interest = openingBalance * input.interestRate / 100;
    let repayment = 0;
    if (year > grace && year <= term) {
      if (method === "interest-only") repayment = year === term ? openingBalance : 0;
      else if (method === "annuity") repayment = Math.min(openingBalance, Math.max(0, annuity - interest));
      else repayment = Math.min(openingBalance, amortisingDebt / repaymentYears + (method === "balloon" && year === term ? balloon : 0));
    }
    balance = Math.max(0, openingBalance - repayment);
    return { year, openingBalance, principal: repayment, interest, debtService: repayment + interest, closingBalance: balance };
  });
}

export function buildLinkedStatements(input: FinancialModelInputs, projections: ProjectionYear[]): StatementYear[] {
  const loan = buildLoanSchedule(input);
  const initialEquityFunding = input.fundingRequired * (1 - input.debtShare / 100);
  let accumulatedProfit = 0;
  let openingCash = 0;
  let previousWorkingCapital = 0;
  return projections.map((row, index) => {
    const debtYear = loan[index];
    const interest = debtYear.interest;
    const tax = Math.max(0, row.ebit - interest) * input.taxRate / 100;
    const netProfit = row.ebit - interest - tax;
    accumulatedProfit += netProfit;
    const receivables = row.receivablesBalance ?? row.revenue * input.receivableDays / 365;
    const payables = row.payablesBalance ?? row.costOfSales * input.payableDays / 365;
    const inventory = row.inventoryBalance ?? row.costOfSales * (input.inventoryDays ?? 0) / 365;
    const workingCapital = receivables + inventory - payables;
    const workingCapitalMovement = workingCapital - previousWorkingCapital;
    const operatingCashFlow = netProfit + row.depreciation - workingCapitalMovement;
    const netPpe = row.netPpeBalance ?? Math.max(0, input.capex - row.depreciation * (index + 1));
    const investingCashFlow = -(row.capexPurchases ?? (index === 0 ? input.capex : 0));
    const financingCashFlow = index === 0 ? input.fundingRequired - debtYear.principal : -debtYear.principal;
    const closingCash = openingCash + operatingCashFlow + investingCashFlow + financingCashFlow;
    const totalAssets = closingCash + receivables + inventory + netPpe;
    const totalLiabilities = payables + debtYear.closingBalance;
    // Equity is derived only from explicit financing and accumulated earnings.
    // Any omitted opening balance or cash-flow movement must remain visible in balanceCheck.
    const contributedCapital = initialEquityFunding;
    const retainedEarnings = accumulatedProfit;
    const equity = contributedCapital + retainedEarnings;
    const totalLiabilitiesAndEquity = totalLiabilities + equity;
    const netCashMovement = closingCash - openingCash;
    const currentAssets = closingCash + receivables + inventory;
    const currentLiabilities = payables + debtYear.principal;
    const capitalEmployed = totalAssets - currentLiabilities;
    const result: StatementYear = { year: row.year, revenue: row.revenue, costOfSales: row.costOfSales,
      grossProfit: row.grossProfit, operatingExpenses: row.operatingExpenses, ebitda: row.ebitda,
      depreciation: row.depreciation, ebit: row.ebit, interest, tax,
      netProfit, receivables, inventory, cash: closingCash, netPpe, totalAssets, payables,
      debt: debtYear.closingBalance, totalLiabilities, contributedCapital, retainedEarnings, equity, totalLiabilitiesAndEquity,
      balanceCheck: totalAssets - totalLiabilitiesAndEquity, operatingCashFlow,
      investingCashFlow, financingCashFlow, netCashMovement, openingCash, closingCash,
      currentRatio: currentLiabilities ? currentAssets / currentLiabilities : 0,
      quickRatio: currentLiabilities ? (closingCash + receivables) / currentLiabilities : 0,
      cashRatio: currentLiabilities ? closingCash / currentLiabilities : 0,
      debtToEquity: equity ? debtYear.closingBalance / equity : 0,
      interestCover: debtYear.interest ? row.ebit / debtYear.interest : 0,
      dscr: debtYear.debtService ? (row.ebitda - tax) / debtYear.debtService : 0,
      grossMargin: row.revenue ? row.grossProfit / row.revenue : 0,
      ebitdaMargin: row.revenue ? row.ebitda / row.revenue : 0,
      operatingMargin: row.revenue ? row.ebit / row.revenue : 0,
      netMargin: row.revenue ? netProfit / row.revenue : 0,
      returnOnAssets: totalAssets ? netProfit / totalAssets : 0,
      returnOnEquity: equity ? netProfit / equity : 0,
      returnOnCapitalEmployed: capitalEmployed ? row.ebit / capitalEmployed : 0,
      assetTurnover: totalAssets ? row.revenue / totalAssets : 0,
      debtToEbitda: row.ebitda ? debtYear.closingBalance / row.ebitda : 0,
      debtRatio: totalAssets ? debtYear.closingBalance / totalAssets : 0,
      gearing: equity + debtYear.closingBalance ? debtYear.closingBalance / (equity + debtYear.closingBalance) : 0 };
    openingCash = closingCash;
    previousWorkingCapital = workingCapital;
    return result;
  });
}
