import type { FinancialModelInputs, ProjectionYear } from "@/lib/financialModellingEngine";
import { buildLinkedStatements, type StatementYear } from "@/lib/phase1FinancialEngine";

export type ScenarioDriverSet = {
  annualRevenueGrowthDelta: number;
  priceDelta: number;
  operatingCostDelta: number;
  interestRateDelta: number;
  launchDelayYears: number;
};

export type ScenarioConfiguration = {
  optimistic: ScenarioDriverSet;
  conservative: ScenarioDriverSet;
};

export type ScenarioCase = {
  key: "base" | "optimistic" | "conservative";
  label: string;
  statements: StatementYear[];
};

export const DEFAULT_SCENARIO_CONFIGURATION: ScenarioConfiguration = {
  optimistic: { annualRevenueGrowthDelta: 10, priceDelta: 5, operatingCostDelta: -3, interestRateDelta: -1, launchDelayYears: 0 },
  conservative: { annualRevenueGrowthDelta: -12, priceDelta: -5, operatingCostDelta: 8, interestRateDelta: 2, launchDelayYears: 1 },
};

function applyScenario(base: ProjectionYear[], drivers: ScenarioDriverSet): ProjectionYear[] {
  return base.map((row, index) => {
    const source = base[Math.max(0, index - Math.max(0, Math.round(drivers.launchDelayYears)))] ?? row;
    const delayed = index < drivers.launchDelayYears;
    const growthFactor = Math.pow(1 + drivers.annualRevenueGrowthDelta / 100, index + 1);
    const priceFactor = 1 + drivers.priceDelta / 100;
    const revenue = delayed ? 0 : Math.max(0, source.revenue * growthFactor * priceFactor);
    const revenueRatio = source.revenue ? revenue / source.revenue : 0;
    const costFactor = Math.max(0, 1 + drivers.operatingCostDelta / 100);
    const costOfSales = source.costOfSales * revenueRatio * costFactor;
    const operatingExpenses = source.operatingExpenses * costFactor;
    const grossProfit = revenue - costOfSales;
    const ebitda = grossProfit - operatingExpenses;
    const ebit = ebitda - source.depreciation;
    return { ...source, year: row.year, revenue, costOfSales, grossProfit, operatingExpenses, ebitda, ebit,
      ebitdaMargin: revenue ? ebitda / revenue * 100 : 0 };
  });
}

export function buildOperationalScenarios(input: FinancialModelInputs, base: ProjectionYear[], configuration: ScenarioConfiguration): ScenarioCase[] {
  const baseStatements = buildLinkedStatements(input, base);
  const make = (key: "optimistic" | "conservative", label: string) => {
    const drivers = configuration[key];
    const scenarioInput = { ...input, interestRate: Math.max(0, input.interestRate + drivers.interestRateDelta) };
    return { key, label, statements: buildLinkedStatements(scenarioInput, applyScenario(base, drivers)) } as ScenarioCase;
  };
  return [{ key:"base", label:"Base case", statements:baseStatements }, make("optimistic","Optimistic case"), make("conservative","Conservative case")];
}
