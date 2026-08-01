import type { FinancialModelInputs, ProjectionYear } from "@/lib/financialModellingEngine";
import { buildLinkedStatements, type StatementYear } from "@/lib/phase1FinancialEngine";
import { calculateProjectPortfolio, consolidateProjectPortfolio, hasConfiguredProjects, type ModelProject, type ProjectDriver } from "@/lib/projectPortfolioEngine";

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

function adjustDriver(driver:ProjectDriver,drivers:ScenarioDriverSet,kind:"revenue"|"cost"):ProjectDriver {
  return {...driver,quantityGrowth:(driver.quantityGrowth??0)+(kind==="revenue"?drivers.annualRevenueGrowthDelta:0),unitAmount:(driver.unitAmount??driver.amount??0)*(1+(kind==="revenue"?drivers.priceDelta:drivers.operatingCostDelta)/100)};
}

function buildProjectScenario(input:FinancialModelInputs,projects:ModelProject[],drivers:ScenarioDriverSet,payrollByYear:Record<number,number>):ProjectionYear[] {
  const adjusted=projects.map(project=>({...project,startYear:project.startYear+Math.max(0,Math.round(drivers.launchDelayYears)),annualGrowth:project.annualGrowth+drivers.annualRevenueGrowthDelta,revenuePerUnit:project.revenuePerUnit*(1+drivers.priceDelta/100),directCostRate:project.directCostRate*(1+drivers.operatingCostDelta/100),annualFixedCosts:project.annualFixedCosts*(1+drivers.operatingCostDelta/100),revenueDrivers:(project.revenueDrivers??[]).map(driver=>adjustDriver(driver,drivers,"revenue")),costDrivers:(project.costDrivers??[]).map(driver=>adjustDriver(driver,drivers,"cost"))}));
  const portfolio=consolidateProjectPortfolio(calculateProjectPortfolio(adjusted,input.years),input.years);
  const depreciation=input.capex/Math.max(input.years,5),costFactor=1+drivers.operatingCostDelta/100;
  return portfolio.map((row,index)=>{const year=index+1,operatingExpenses=row.fixedCosts+(payrollByYear[year]??input.annualPayroll*Math.pow(1+input.opexInflation/100,index))*costFactor+input.annualOverheads*Math.pow(1+input.opexInflation/100,index)*costFactor;const ebitda=row.revenue-row.directCosts-operatingExpenses,ebit=ebitda-depreciation;return {year,customers:0,revenue:row.revenue,costOfSales:row.directCosts,grossProfit:row.revenue-row.directCosts,operatingExpenses,ebitda,depreciation,ebit,interest:0,tax:0,netProfit:0,operatingCashFlow:0,closingCash:0,debtBalance:0,dscr:0,ebitdaMargin:row.revenue?ebitda/row.revenue*100:0,receivablesBalance:row.receivables,inventoryBalance:row.inventory,payablesBalance:row.payables};});
}

export function buildDriverBasedOperationalScenarios(input:FinancialModelInputs,base:ProjectionYear[],projects:ModelProject[],configuration:ScenarioConfiguration,payrollByYear:Record<number,number>={}):ScenarioCase[] {
  if(!hasConfiguredProjects(projects))return buildOperationalScenarios(input,base,configuration);
  const baseStatements=buildLinkedStatements(input,base);
  const make=(key:"optimistic"|"conservative",label:string)=>{const drivers=configuration[key],scenarioInput={...input,interestRate:Math.max(0,input.interestRate+drivers.interestRateDelta)};return {key,label,statements:buildLinkedStatements(scenarioInput,buildProjectScenario(scenarioInput,projects,drivers,payrollByYear))} as ScenarioCase;};
  return [{key:"base",label:"Base case",statements:baseStatements},make("optimistic","Optimistic case"),make("conservative","Conservative case")];
}
