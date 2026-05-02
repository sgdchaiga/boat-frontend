/** Hotel Assessment Engine: weighted scoring, readiness, rule-based module recommendations. */

export const ASSESSMENT_CATEGORY_WEIGHTS: Record<string, number> = {
  front_office: 0.15,
  billing: 0.2,
  pos: 0.15,
  inventory: 0.15,
  accounting: 0.1,
  housekeeping: 0.1,
  controls: 0.1,
  technology: 0.05,
};

export type AssessmentCategory = keyof typeof ASSESSMENT_CATEGORY_WEIGHTS;

export type ReadinessLevel = "HIGH" | "MEDIUM" | "LOW" | "CRITICAL";

export type RecommendationPriority = "high" | "medium" | "low";

export interface ScoreRow {
  category: string;
  item: string;
  score: number;
}

export interface RecommendationRow {
  module: string;
  priority: RecommendationPriority;
  reason?: string;
}

export const ASSESSMENT_SCORE_ITEMS: { category: AssessmentCategory; item: string }[] = [
  { category: "front_office", item: "Guest check-in / check-out accuracy" },
  { category: "front_office", item: "Reservation handling & overbooking control" },
  { category: "front_office", item: "Guest communication & complaint handling" },
  { category: "billing", item: "Billing accuracy" },
  { category: "billing", item: "Posting of charges (rooms, F&B, extras)" },
  { category: "billing", item: "Discount control" },
  { category: "billing", item: "Credit sales / city ledger discipline" },
  { category: "pos", item: "Bar & restaurant order capture" },
  { category: "pos", item: "Cash / M-POS reconciliation" },
  { category: "pos", item: "Discounts & voids authorization" },
  { category: "inventory", item: "Stores issues & requisitions" },
  { category: "inventory", item: "Stock counts & variance follow-up" },
  { category: "inventory", item: "Recipe / consumption tracking (F&B)" },
  { category: "accounting", item: "Chart of accounts & period close" },
  { category: "accounting", item: "Bank & mobile money reconciliations" },
  { category: "accounting", item: "Management reporting timeliness" },
  { category: "housekeeping", item: "Room status & maintenance handoff" },
  { category: "housekeeping", item: "Linen / consumables control" },
  { category: "controls", item: "Segregation of duties (cash, inventory)" },
  { category: "controls", item: "Approval limits & audit trail" },
  { category: "technology", item: "Backups, access control, uptime" },
];

export function averageForCategory(scores: ScoreRow[], category: string): number {
  const list = scores.filter((s) => s.category === category);
  if (list.length === 0) return 0;
  const sum = list.reduce((acc, s) => acc + s.score, 0);
  return sum / list.length;
}

export function calculateScore(scores: ScoreRow[]): number {
  let total = 0;
  for (const category of Object.keys(ASSESSMENT_CATEGORY_WEIGHTS)) {
    const w = ASSESSMENT_CATEGORY_WEIGHTS[category] ?? 0;
    const avg = averageForCategory(scores, category);
    total += avg * w;
  }
  return Math.round(total * 1000) / 1000;
}

export function getReadiness(score: number): ReadinessLevel {
  if (score >= 4) return "HIGH";
  if (score >= 3) return "MEDIUM";
  if (score >= 2) return "LOW";
  return "CRITICAL";
}

export function categoryAveragesMap(scores: ScoreRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const category of Object.keys(ASSESSMENT_CATEGORY_WEIGHTS)) {
    out[category] = Math.round(averageForCategory(scores, category) * 100) / 100;
  }
  return out;
}

export function topRiskCategories(scores: ScoreRow[], limit = 3): string[] {
  const avgs = categoryAveragesMap(scores);
  return Object.entries(avgs)
    .sort((a, b) => a[1] - b[1])
    .slice(0, limit)
    .filter(([, v]) => v > 0)
    .map(([k]) => k);
}

export function categoryLabel(key: string): string {
  const map: Record<string, string> = {
    front_office: "Front office",
    billing: "Billing",
    pos: "POS",
    inventory: "Inventory",
    accounting: "Accounting",
    housekeeping: "Housekeeping",
    controls: "Controls",
    technology: "Technology",
  };
  return map[key] ?? key;
}

export function formatRiskLabels(categories: string[]): string[] {
  return categories.map(categoryLabel);
}

/**
 * Rule-based recommendations (prescriptive sales layer).
 */
export function buildRecommendations(scores: ScoreRow[]): RecommendationRow[] {
  const out: RecommendationRow[] = [];
  const avg = categoryAveragesMap(scores);

  const add = (module: string, priority: RecommendationPriority, reason: string, when: boolean) => {
    if (!when) return;
    if (!out.some((r) => r.module === module)) {
      out.push({ module, priority, reason });
    }
  };

  if (avg.billing < 3) {
    add("Accounting + POS Integration", "high", "Billing discipline below threshold", true);
  }
  if (avg.inventory < 3) {
    add("Inventory Module", "high", "Stock control gap", true);
  }
  if (avg.pos < 3) {
    add("POS System", "high", "F&B / retail capture weak", true);
  }
  if (avg.controls < 3) {
    add("Audit & Controls Module", "high", "Internal control maturity low", true);
  }
  if (avg.front_office < 3) {
    add("Front Desk Module", "high", "Front-office operations inconsistent", true);
  }
  if (avg.accounting < 3 && !out.some((r) => r.module.startsWith("Accounting"))) {
    add("Accounting Suite", "medium", "Financial close / reporting stress", true);
  }
  if (avg.housekeeping < 3) {
    add("Housekeeping / Maintenance workflow", "medium", "Rooms ops visibility needed", true);
  }
  if (avg.technology < 3) {
    add("Technology & backups review", "low", "IT resilience exposure", true);
  }

  const priorityOrder: RecommendationPriority[] = ["high", "medium", "low"];
  out.sort((a, b) => priorityOrder.indexOf(a.priority) - priorityOrder.indexOf(b.priority));
  return out;
}

/** Placeholder fees for auto-proposal (UGX); tune with commercial team. */
export const PROPOSAL_MODULE_FEES_UGX: Record<string, { setup: number; monthly: number }> = {
  "Accounting + POS Integration": { setup: 4_500_000, monthly: 350_000 },
  "Inventory Module": { setup: 2_800_000, monthly: 220_000 },
  "POS System": { setup: 3_200_000, monthly: 280_000 },
  "Audit & Controls Module": { setup: 1_800_000, monthly: 150_000 },
  "Front Desk Module": { setup: 2_400_000, monthly: 200_000 },
  "Accounting Suite": { setup: 3_600_000, monthly: 300_000 },
  "Housekeeping / Maintenance workflow": { setup: 1_200_000, monthly: 120_000 },
  "Technology & backups review": { setup: 800_000, monthly: 80_000 },
};

export function defaultPricingForModule(module: string): { setup: number; monthly: number } {
  return PROPOSAL_MODULE_FEES_UGX[module] ?? { setup: 2_000_000, monthly: 180_000 };
}

/**
 * Rough “revenue leakage” band (UGX / month) from operational maturity gap + scale.
 * Heuristic — calibrate against your market; intended for sales conversation, not accounting.
 */
export function estimateMonthlyRevenueLeakageUgx(input: {
  weightedScore: number;
  rooms: number;
  occupancyPct: number;
}): { low: number; high: number } {
  const score = Math.min(5, Math.max(0, input.weightedScore));
  const gap = Math.max(0, 5 - score);
  const roomFactor = Math.max(0.45, Math.min(2.4, 0.55 + input.rooms / 90));
  const occFactor = Math.max(0.32, Math.min(1.25, (input.occupancyPct || 0) / 100));
  const base = 750_000 * gap * roomFactor * occFactor;
  return {
    low: Math.round(base * 0.5),
    high: Math.round(base * 1.85),
  };
}

export function formatLeakageSentenceUgx(low: number, high: number): string {
  const a = Math.round(low).toLocaleString("en-UG");
  const b = Math.round(high).toLocaleString("en-UG");
  return `Based on this score and scale, you may be leaving approximately UGX ${a}–${b} / month on the table from billing gaps, stock variance, and weak controls (indicative range).`;
}
