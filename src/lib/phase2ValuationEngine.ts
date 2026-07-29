import type { StatementYear } from "@/lib/phase1FinancialEngine";

export type ValuationAssumptions = {
  discountRate: number;
  terminalGrowthRate: number;
  initialInvestment: number;
};

export type ValuationResult = {
  freeCashFlows: number[];
  terminalValue: number;
  presentValueOfForecast: number;
  presentValueOfTerminal: number;
  enterpriseValue: number;
  netDebt: number;
  equityValue: number;
  npv: number;
  irr: number | null;
  paybackPeriod: number | null;
};

function npv(rate: number, cashFlows: number[]) {
  return cashFlows.reduce((sum, cashFlow, index) => sum + cashFlow / Math.pow(1 + rate, index), 0);
}

function calculateIrr(cashFlows: number[]) {
  if (!cashFlows.some(value => value < 0) || !cashFlows.some(value => value > 0)) return null;
  let low = -0.999, high = 10;
  if (npv(low, cashFlows) * npv(high, cashFlows) > 0) return null;
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const mid = (low + high) / 2;
    const value = npv(mid, cashFlows);
    if (Math.abs(value) < .01) return mid;
    if (npv(low, cashFlows) * value <= 0) high = mid; else low = mid;
  }
  return (low + high) / 2;
}

export function calculateDcfValuation(statements: StatementYear[], assumptions: ValuationAssumptions): ValuationResult {
  const discountRate = Math.max(.001, assumptions.discountRate / 100);
  const terminalGrowth = Math.min(discountRate - .001, assumptions.terminalGrowthRate / 100);
  const freeCashFlows = statements.map(row => row.operatingCashFlow + row.interest * (1 - (row.ebit > 0 ? row.tax / Math.max(1, row.ebit - row.interest) : 0)) + row.investingCashFlow);
  const finalCashFlow = freeCashFlows[freeCashFlows.length - 1] ?? 0;
  const terminalValue = Math.max(0, finalCashFlow * (1 + terminalGrowth) / (discountRate - terminalGrowth));
  const presentValueOfForecast = freeCashFlows.reduce((sum, value, index) => sum + value / Math.pow(1 + discountRate, index + 1), 0);
  const presentValueOfTerminal = terminalValue / Math.pow(1 + discountRate, statements.length);
  const enterpriseValue = presentValueOfForecast + presentValueOfTerminal;
  const last = statements[statements.length - 1];
  const netDebt = Math.max(0, (last?.debt ?? 0) - (last?.cash ?? 0));
  const equityValue = enterpriseValue - netDebt;
  const investmentCashFlows = [-Math.abs(assumptions.initialInvestment), ...freeCashFlows];
  let cumulative = investmentCashFlows[0], paybackPeriod: number | null = null;
  for (let year = 1; year < investmentCashFlows.length; year += 1) {
    const previous = cumulative;
    cumulative += investmentCashFlows[year];
    if (cumulative >= 0) { paybackPeriod = (year - 1) + (investmentCashFlows[year] ? Math.abs(previous) / investmentCashFlows[year] : 0); break; }
  }
  return { freeCashFlows, terminalValue, presentValueOfForecast, presentValueOfTerminal, enterpriseValue, netDebt, equityValue,
    npv: npv(discountRate, investmentCashFlows), irr: calculateIrr(investmentCashFlows), paybackPeriod };
}

export function buildValuationSensitivity(statements: StatementYear[], assumptions: ValuationAssumptions) {
  const discountRates = [-4,-2,0,2,4].map(delta => Math.max(1, assumptions.discountRate + delta));
  const terminalGrowthRates = [-2,-1,0,1,2].map(delta => Math.max(0, assumptions.terminalGrowthRate + delta));
  return { discountRates, terminalGrowthRates, values: terminalGrowthRates.map(growth => discountRates.map(discountRate =>
    calculateDcfValuation(statements, { ...assumptions, discountRate, terminalGrowthRate: Math.min(growth, discountRate - .1) }).enterpriseValue
  )) };
}
