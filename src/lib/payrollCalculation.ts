/** Money helpers — 2 decimal places. */
export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export type PayrollStatutoryInput = {
  payePersonalReliefMonthly: number;
  payeTaxableBand1Limit: number;
  payeRateBand1Pct: number;
  payeRateAboveBand1Pct: number;
  nssfEmployeeRatePct: number;
  nssfEmployerRatePct: number;
  nssfGrossCeiling: number | null;
};

export type PayeTaxBand = {
  /** Inclusive lower edge of this band. */
  lower: number;
  /** Exclusive upper edge; null means no upper limit. */
  upper: number | null;
  ratePct: number;
  /** Tax already due when gross pay reaches this band's lower edge. */
  minimumTax: number;
};

export const DEFAULT_PAYE_TAX_BANDS: PayeTaxBand[] = [
  { lower: 0, upper: 235_000, ratePct: 0, minimumTax: 0 },
  { lower: 235_000, upper: 335_000, ratePct: 10, minimumTax: 0 },
  { lower: 335_000, upper: 410_000, ratePct: 20, minimumTax: 10_000 },
  { lower: 410_000, upper: 10_000_000, ratePct: 30, minimumTax: 25_000 },
  { lower: 10_000_000, upper: null, ratePct: 40, minimumTax: 2_902_000 },
];

export function normalizePayeTaxBands(value: unknown): PayeTaxBand[] {
  if (!Array.isArray(value)) return DEFAULT_PAYE_TAX_BANDS.map((band) => ({ ...band }));
  let inferredMinimum = 0;
  const bands = value.map((item) => {
    const row = (item || {}) as Record<string, unknown>;
    const band = {
      lower: Number(row.lower),
      upper: row.upper == null || row.upper === "" ? null : Number(row.upper),
      ratePct: Number(row.ratePct ?? row.rate_pct),
      minimumTax: row.minimumTax == null && row.minimum_tax == null
        ? roundMoney(inferredMinimum)
        : Number(row.minimumTax ?? row.minimum_tax),
    };
    if (band.upper != null) inferredMinimum = band.minimumTax + (band.upper - band.lower) * band.ratePct / 100;
    return band;
  });
  return validatePayeTaxBands(bands).length === 0 ? bands : DEFAULT_PAYE_TAX_BANDS.map((band) => ({ ...band }));
}

export function validatePayeTaxBands(bands: PayeTaxBand[]): string[] {
  const errors: string[] = [];
  if (bands.length === 0) return ["Add at least one PAYE tax band."];
  bands.forEach((band, index) => {
    if (!Number.isFinite(band.lower) || band.lower < 0) errors.push(`Band ${index + 1} has an invalid lower limit.`);
    if (band.upper != null && (!Number.isFinite(band.upper) || band.upper <= band.lower)) errors.push(`Band ${index + 1} must end above its lower limit.`);
    if (!Number.isFinite(band.ratePct) || band.ratePct < 0 || band.ratePct > 100) errors.push(`Band ${index + 1} rate must be between 0% and 100%.`);
    if (!Number.isFinite(band.minimumTax) || band.minimumTax < 0) errors.push(`Band ${index + 1} minimum tax must be zero or more.`);
    if (index === 0 && band.lower !== 0) errors.push("The first PAYE band must start at 0.");
    if (index > 0 && band.lower !== bands[index - 1].upper) errors.push(`Band ${index + 1} must start where band ${index} ends.`);
    if (index < bands.length - 1 && band.upper == null) errors.push(`Only the last PAYE band may have no upper limit.`);
  });
  if (bands[bands.length - 1]?.upper != null) errors.push("The last PAYE band must have no upper limit.");
  return errors;
}

/** Progressive PAYE computed from user-configurable gross-pay bands. */
export function computePayeFromBands(grossPay: number, configuredBands?: unknown): number {
  const gross = Math.max(0, Number(grossPay) || 0);
  const bands = normalizePayeTaxBands(configuredBands);
  const band = bands.find((item) => gross >= item.lower && (item.upper == null || gross < item.upper));
  if (!band) return 0;
  return roundMoney(band.minimumTax + Math.max(0, gross - band.lower) * band.ratePct / 100);
}

const DEFAULT_STATUTORY: PayrollStatutoryInput = {
  payePersonalReliefMonthly: 235_000,
  payeTaxableBand1Limit: 235_000,
  payeRateBand1Pct: 0,
  payeRateAboveBand1Pct: 30,
  nssfEmployeeRatePct: 5,
  nssfEmployerRatePct: 10,
  nssfGrossCeiling: null,
};

export function mergeStatutory(overrides: Partial<PayrollStatutoryInput> | null): PayrollStatutoryInput {
  return { ...DEFAULT_STATUTORY, ...overrides };
}

/**
 * NSSF on gross salary; optional ceiling on gross used for the percentage.
 */
export function computeNssfEmployee(gross: number, s: PayrollStatutoryInput): number {
  const base =
    s.nssfGrossCeiling != null && s.nssfGrossCeiling > 0 ? Math.min(gross, s.nssfGrossCeiling) : gross;
  return roundMoney((base * s.nssfEmployeeRatePct) / 100);
}

export function computeNssfEmployer(gross: number, s: PayrollStatutoryInput): number {
  const base =
    s.nssfGrossCeiling != null && s.nssfGrossCeiling > 0 ? Math.min(gross, s.nssfGrossCeiling) : gross;
  return roundMoney((base * s.nssfEmployerRatePct) / 100);
}

/**
 * Simplified PAYE: apply personal relief to taxable income, then band 1 at rate1, remainder at rate2.
 * Kept for backwards compatibility; payroll runs use {@link computePayeFromGrossExcelBands} instead.
 */
export function computePAYE(taxableIncome: number, s: PayrollStatutoryInput): number {
  const afterRelief = Math.max(0, taxableIncome - s.payePersonalReliefMonthly);
  let tax = 0;
  const b1 = Math.min(afterRelief, s.payeTaxableBand1Limit);
  tax += (b1 * s.payeRateBand1Pct) / 100;
  const remainder = Math.max(0, afterRelief - s.payeTaxableBand1Limit);
  tax += (remainder * s.payeRateAboveBand1Pct) / 100;
  return roundMoney(tax);
}

/**
 * PAYE on **gross pay** (Excel J8), matching:
 * `IF(J8>10000000,(J8-410000)*30%+25000+(J8-10000000)*10%,
 *   IF(J8>=410000,(J8-410000)*30%+25000,
 *   IF(J8>=335000,(J8-335000)*20%+10000,
 *   IF(J8>=235000,(J8-235000)*10%,0))))`
 */
export function computePayeFromGrossExcelBands(grossPay: number): number {
  return computePayeFromBands(grossPay, DEFAULT_PAYE_TAX_BANDS);
}

/** Postgres `numeric` / Supabase may return number or string; normalize for UI and math. */
export function parsePayrollMoney(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Deduction for days absent: (full monthly gross / working days in month) × days absent.
 * Returns 0 if inputs are invalid or absent is 0.
 */
export function computeAbsentDeduction(
  fullMonthlyGross: number,
  daysAbsent: number,
  workingDaysPerMonth: number
): number {
  const gross = Number(fullMonthlyGross);
  const absent = Number(daysAbsent);
  const wd = Number(workingDaysPerMonth);
  if (!Number.isFinite(gross) || gross <= 0 || !Number.isFinite(absent) || absent <= 0) return 0;
  if (!Number.isFinite(wd) || wd <= 0) return 0;
  const daily = gross / wd;
  return roundMoney(daily * absent);
}

export function grossFromProfile(row: {
  base_salary: number;
  housing_allowance: number;
  transport_allowance: number;
  responsibility_allowance?: number;
  other_allowances?: unknown;
}): number {
  let extra = 0;
  const o = row.other_allowances;
  if (Array.isArray(o)) {
    for (const item of o) {
      if (item && typeof item === "object" && "amount" in item) {
        extra += Number((item as { amount?: number }).amount ?? 0);
      }
    }
  }
  return roundMoney(
    parsePayrollMoney(row.base_salary) +
      parsePayrollMoney(row.housing_allowance) +
      parsePayrollMoney(row.transport_allowance) +
      parsePayrollMoney(row.responsibility_allowance ?? 0) +
      extra
  );
}
