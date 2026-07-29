export type ProjectBusinessType = "education-technology" | "hardware" | "subscription" | "services" | "fintech" | "agritech" | "government" | "social-impact";
export type DriverFrequency = "monthly" | "quarterly" | "annual" | "one-off";
export type ProjectDriver = {
  id: string; name: string; amount: number; quantity?: number; unitAmount?: number; frequency?: DriverFrequency;
  linkedRevenueDriverId?: string; revenueUnitsPerCostUnit?: number;
  linkedDriverId?: string; linkedUnitsPerUnit?: number;
  quantityGrowth?: number; unitAmountGrowth?: number;
  yearlyOverrides?: Record<number, { quantity?: number; unitAmount?: number }>;
};

export function driverValuesForYear(driver: ProjectDriver, year: number, linkedQuantity?: number) {
  const override = driver.yearlyOverrides?.[year] ?? {};
  const linkedId = driver.linkedDriverId ?? driver.linkedRevenueDriverId;
  const unitsPerUnit = driver.linkedUnitsPerUnit ?? driver.revenueUnitsPerCostUnit;
  const extrapolatedQuantity = Math.max(0, driver.quantity ?? 0) * Math.pow(1 + (driver.quantityGrowth ?? 0) / 100, Math.max(0, year - 1));
  const quantity = override.quantity ?? (linkedId && linkedQuantity != null
    ? Math.ceil(Math.max(0, linkedQuantity) / Math.max(1, unitsPerUnit ?? 1))
    : extrapolatedQuantity);
  const unitAmount = override.unitAmount ?? Math.max(0, driver.unitAmount ?? driver.amount ?? 0) * Math.pow(1 + (driver.unitAmountGrowth ?? 0) / 100, Math.max(0, year - 1));
  return { quantity, unitAmount };
}

export function annualDriverAmount(driver: ProjectDriver, linkedRevenueQuantity?: number) {
  if (driver.quantity != null || driver.unitAmount != null || driver.frequency != null) {
    const multiplier = driver.frequency === "monthly" ? 12 : driver.frequency === "quarterly" ? 4 : 1;
    const linkedId = driver.linkedDriverId ?? driver.linkedRevenueDriverId;
    const unitsPerUnit = driver.linkedUnitsPerUnit ?? driver.revenueUnitsPerCostUnit;
    const quantity = linkedId && linkedRevenueQuantity != null
      ? Math.ceil(Math.max(0, linkedRevenueQuantity) / Math.max(1, unitsPerUnit ?? 1))
      : Math.max(0, driver.quantity ?? 0);
    return quantity * Math.max(0, driver.unitAmount ?? 0) * multiplier;
  }
  return Math.max(0, driver.amount || 0);
}

export function annualDriverAmountForYear(driver: ProjectDriver, year: number, linkedRevenueQuantity?: number) {
  if (driver.frequency === "one-off" && year !== 1) return 0;
  const values = driverValuesForYear(driver, year, linkedRevenueQuantity);
  const multiplier = driver.frequency === "monthly" ? 12 : driver.frequency === "quarterly" ? 4 : 1;
  return values.quantity * values.unitAmount * multiplier;
}

function driverAmountForProjectYear(driver: ProjectDriver, activeYears: number, linkedRevenueQuantity?: number) {
  if (driver.frequency === "one-off" && activeYears !== 0) return 0;
  return annualDriverAmountForYear(driver, activeYears + 1, linkedRevenueQuantity);
}

export type ModelProject = {
  id: string; name: string; businessType: ProjectBusinessType; enabled: boolean;
  startingUnits: number; annualGrowth: number; revenuePerUnit: number;
  directCostRate: number; annualFixedCosts: number; startYear: number;
  revenueDrivers?: ProjectDriver[]; costDrivers?: ProjectDriver[];
};

export const PROJECT_BUSINESS_SUGGESTIONS: Record<ProjectBusinessType, { revenue: string[]; costs: string[] }> = {
  "education-technology": { revenue: ["Learner subscriptions", "Tablet and device sales", "School licences", "Teacher licences", "Government deployments", "Content upgrades", "Training", "Technical support", "Learning analytics", "Digital examinations"], costs: ["Devices and accessories", "Shipping and import duties", "Curriculum content", "Cloud hosting", "Software development", "Teacher onboarding", "Customer support", "Content licensing", "Warranty and repairs", "Sales and school acquisition"] },
  hardware: { revenue: ["Product sales", "Installation fees", "Maintenance contracts", "Accessories", "Warranty extensions"], costs: ["Product acquisition", "Assembly", "Shipping", "Import duties", "Installation", "Warranty and returns"] },
  subscription: { revenue: ["Monthly subscriptions", "Annual subscriptions", "Premium tier", "Enterprise licences", "Setup fees"], costs: ["Cloud hosting", "Content licensing", "Customer support", "Payment fees", "Software development"] },
  services: { revenue: ["Consulting fees", "Implementation", "Training", "Technical support", "Repairs"], costs: ["Professional staff", "Travel", "Tools and equipment", "Contractors", "Service consumables"] },
  fintech: { revenue: ["Transaction fees", "Merchant commission", "Wallet fees", "Integration fees", "Interest income"], costs: ["Payment processor fees", "Fraud losses", "Compliance", "Platform hosting", "Agent commissions"] },
  agritech: { revenue: ["Farmer subscriptions", "Input sales", "Market commissions", "Data services", "Advisory services"], costs: ["Field agents", "Agronomy content", "Logistics", "Demonstration farms", "Data collection"] },
  government: { revenue: ["Product deliveries", "Implementation milestones", "Annual support", "Licensing", "Training"], costs: ["Procurement", "Deployment", "Training delivery", "Cloud infrastructure", "Warranty", "Project management"] },
  "social-impact": { revenue: ["Grant income", "Sponsorship", "Training contracts", "Impact-linked payments"], costs: ["Beneficiary training", "Facilitators", "Learning materials", "Monitoring and evaluation", "Outreach"] },
};

export type ProjectProjection = {
  projectId: string; name: string; businessType: ProjectBusinessType; year: number;
  units: number; revenue: number; directCosts: number; fixedCosts: number; ebitda: number;
};

export const EDTECH_PROJECT_PORTFOLIO: ModelProject[] = [
  { id: "core", name: "SqillPad Commercial", businessType: "hardware", enabled: true, startingUnits: 2000, annualGrowth: 25, revenuePerUnit: 640000, directCostRate: 64, annualFixedCosts: 280000000, startYear: 1, revenueDrivers: [], costDrivers: [] },
  { id: "subscriptions", name: "Learner Subscriptions", businessType: "subscription", enabled: true, startingUnits: 10000, annualGrowth: 25, revenuePerUnit: 19500, directCostRate: 24, annualFixedCosts: 180000000, startYear: 1 },
  { id: "mate", name: "SqillMate", businessType: "services", enabled: true, startingUnits: 120, annualGrowth: 30, revenuePerUnit: 2400000, directCostRate: 28, annualFixedCosts: 90000000, startYear: 1 },
  { id: "agro", name: "SqillAgro", businessType: "agritech", enabled: true, startingUnits: 6000, annualGrowth: 35, revenuePerUnit: 36000, directCostRate: 38, annualFixedCosts: 140000000, startYear: 2 },
  { id: "fintech", name: "Payments Aggregator", businessType: "fintech", enabled: true, startingUnits: 180000, annualGrowth: 45, revenuePerUnit: 850, directCostRate: 18, annualFixedCosts: 110000000, startYear: 1 },
  { id: "wallet", name: "School E-wallet", businessType: "fintech", enabled: true, startingUnits: 3500, annualGrowth: 40, revenuePerUnit: 24000, directCostRate: 20, annualFixedCosts: 65000000, startYear: 1 },
  { id: "government", name: "Government Digital Learning", businessType: "government", enabled: false, startingUnits: 101000, annualGrowth: 0, revenuePerUnit: 640000, directCostRate: 66, annualFixedCosts: 760000000, startYear: 2 },
  { id: "reskilling", name: "Youth Reskilling", businessType: "social-impact", enabled: false, startingUnits: 2000, annualGrowth: 15, revenuePerUnit: 200000, directCostRate: 55, annualFixedCosts: 85000000, startYear: 2 },
  { id: "repairs", name: "Repairs & URA Services", businessType: "services", enabled: true, startingUnits: 4200, annualGrowth: 22, revenuePerUnit: 85000, directCostRate: 42, annualFixedCosts: 120000000, startYear: 1 },
];

export function calculateProjectPortfolio(projects: ModelProject[], years: number): ProjectProjection[] {
  return projects.flatMap(project => Array.from({ length: years }, (_, index) => {
    const year = index + 1;
    const activeYears = year - project.startYear;
    const active = project.enabled && activeYears >= 0;
    const units = active ? project.startingUnits * Math.pow(1 + project.annualGrowth / 100, activeYears) : 0;
    const revenueDrivers = project.revenueDrivers ?? [];
    const revenueQuantity = (driver: ProjectDriver, visiting = new Set<string>()): number => {
      if (visiting.has(driver.id)) return 0;
      const linkedId = driver.linkedDriverId ?? driver.linkedRevenueDriverId;
      if (!linkedId) return driverValuesForYear(driver, activeYears + 1).quantity;
      const source = revenueDrivers.find(item => item.id === linkedId);
      if (!source) return driverValuesForYear(driver, activeYears + 1).quantity;
      const next = new Set(visiting); next.add(driver.id);
      return driverValuesForYear(driver, activeYears + 1, revenueQuantity(source, next)).quantity;
    };
    const driverRevenue = revenueDrivers.reduce((sum, driver) => {
      const linkedId = driver.linkedDriverId ?? driver.linkedRevenueDriverId;
      const source = linkedId ? revenueDrivers.find(item => item.id === linkedId) : undefined;
      const linkedQuantity = source ? revenueQuantity(source, new Set([driver.id])) : undefined;
      return sum + driverAmountForProjectYear(driver, activeYears, linkedQuantity);
    }, 0);
    const revenue = active ? units * project.revenuePerUnit + driverRevenue : 0;
    const directCosts = revenue * project.directCostRate / 100;
    const fixedCosts = active ? project.annualFixedCosts + (project.costDrivers ?? []).reduce((sum, driver) => {
      const linkedId = driver.linkedDriverId ?? driver.linkedRevenueDriverId;
      const linkedRevenue = revenueDrivers.find(item => item.id === linkedId);
      const linkedQuantity = linkedRevenue
        ? revenueQuantity(linkedRevenue)
        : undefined;
      return sum + driverAmountForProjectYear(driver, activeYears, linkedQuantity);
    }, 0) : 0;
    return { projectId: project.id, name: project.name, businessType: project.businessType, year,
      units: Math.round(units), revenue, directCosts, fixedCosts, ebitda: revenue - directCosts - fixedCosts };
  }));
}

export function consolidateProjectPortfolio(rows: ProjectProjection[], years: number) {
  return Array.from({ length: years }, (_, index) => {
    const year = index + 1, selected = rows.filter(row => row.year === year);
    return { year, revenue: selected.reduce((sum, row) => sum + row.revenue, 0),
      directCosts: selected.reduce((sum, row) => sum + row.directCosts, 0),
      fixedCosts: selected.reduce((sum, row) => sum + row.fixedCosts, 0),
      ebitda: selected.reduce((sum, row) => sum + row.ebitda, 0) };
  });
}

export function hasConfiguredProjects(projects: ModelProject[]) {
  return projects.some(project => project.enabled && Boolean(project.name.trim()) && (
    project.startingUnits > 0 || project.revenuePerUnit > 0 || project.annualFixedCosts > 0 ||
    (project.revenueDrivers ?? []).some(driver => annualDriverAmount(driver) > 0) ||
    (project.costDrivers ?? []).some(driver => annualDriverAmount(driver) > 0)
  ));
}
