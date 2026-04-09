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
  const J8 = Number(grossPay);
  if (J8 <= 235_000) return 0;
  if (J8 < 335_000) {
    return roundMoney((J8 - 235_000) * 0.1);
  }
  if (J8 < 410_000) {
    return roundMoney((J8 - 335_000) * 0.2 + 10_000);
  }
  if (J8 <= 10_000_000) {
    return roundMoney((J8 - 410_000) * 0.3 + 25_000);
  }
  return roundMoney((J8 - 410_000) * 0.3 + 25_000 + (J8 - 10_000_000) * 0.1);
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
      extra
  );
}
