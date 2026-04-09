/**
 * Depreciation math for fixed assets (straight-line, reducing balance, units of production).
 * Pro-rata: first period from in-service date through period end.
 */

export type DepreciationMethod = "straight_line" | "reducing_balance" | "units_of_production";
export type DepreciationFrequency = "monthly" | "yearly";

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split("-").map((x) => parseInt(x, 10));
  return new Date(y, m - 1, d);
}

/** Inclusive calendar days between two ISO dates. */
export function daysInclusive(isoStart: string, isoEnd: string): number {
  const a = parseLocalDate(isoStart);
  const b = parseLocalDate(isoEnd);
  const diff = Math.floor((b.getTime() - a.getTime()) / 86400000);
  return diff + 1;
}

export function netBookValue(a: {
  cost: number;
  accumulated_depreciation: number;
  revaluation_adjustment: number;
  impairment_loss_accumulated: number;
}): number {
  return roundMoney(
    a.cost - a.accumulated_depreciation + a.revaluation_adjustment - a.impairment_loss_accumulated
  );
}

export interface AssetDepreciationInput {
  cost: number;
  residual_value: number;
  accumulated_depreciation: number;
  revaluation_adjustment: number;
  impairment_loss_accumulated: number;
  depreciation_method: DepreciationMethod;
  useful_life_months: number | null;
  reducing_balance_rate_percent: number | null;
  units_total: number | null;
  units_produced_to_date: number;
  depreciation_frequency: DepreciationFrequency;
  in_service_date: string | null;
  last_depreciation_period_end: string | null;
}

export type DepreciationComputeResult =
  | { ok: true; amount: number; note: string; proRataFactor: number | null }
  | { ok: false; error: string };

/**
 * One schedule slice for [periodStart, periodEnd]. Skips if already depreciated through periodEnd.
 */
export function computeDepreciationForPeriod(
  asset: AssetDepreciationInput,
  periodStart: string,
  periodEnd: string,
  unitsInPeriod: number | null | undefined
): DepreciationComputeResult {
  const nbv = netBookValue(asset);
  const depreciable = Math.max(0, roundMoney(nbv - asset.residual_value));
  if (depreciable <= 0) {
    return { ok: false, error: "Net book value is at or below residual value." };
  }

  if (asset.last_depreciation_period_end && asset.last_depreciation_period_end >= periodEnd) {
    return { ok: false, error: "Depreciation already recorded through this period." };
  }

  const svc = asset.in_service_date;
  if (!svc) {
    return { ok: false, error: "Set in-service date before running depreciation." };
  }

  if (svc > periodEnd) {
    return { ok: false, error: "Asset not yet in service for this period." };
  }

  const effectiveStart = svc > periodStart ? svc : periodStart;
  const periodDays = daysInclusive(periodStart, periodEnd);
  const effectiveDays = daysInclusive(effectiveStart, periodEnd);
  const proRataFactor = periodDays > 0 ? effectiveDays / periodDays : 1;

  if (asset.depreciation_method === "units_of_production") {
    const total = asset.units_total;
    if (total == null || total <= 0) {
      return { ok: false, error: "Units of production requires total estimated units." };
    }
    const u = unitsInPeriod ?? 0;
    if (u <= 0) {
      return { ok: false, error: "Enter units produced for this period." };
    }
    const remainingUnits = Math.max(0, total - asset.units_produced_to_date);
    const useUnits = Math.min(u, remainingUnits);
    const depPerUnit = (asset.cost - asset.residual_value) / total;
    const raw = depPerUnit * useUnits;
    const amount = roundMoney(Math.min(raw, depreciable));
    return {
      ok: true,
      amount,
      note: `UoP: ${useUnits} units × ${roundMoney(depPerUnit)} / unit`,
      proRataFactor: null,
    };
  }

  if (asset.depreciation_method === "reducing_balance") {
    const rate = asset.reducing_balance_rate_percent;
    if (rate == null || rate <= 0) {
      return { ok: false, error: "Reducing balance requires an annual rate %." };
    }
    const annualFactor = rate / 100;
    const periodFactor =
      asset.depreciation_frequency === "yearly"
        ? annualFactor
        : annualFactor / 12;
    let amount = roundMoney(depreciable * periodFactor * proRataFactor);
    amount = Math.min(amount, depreciable);
    return {
      ok: true,
      amount,
      note:
        asset.depreciation_frequency === "yearly"
          ? `RB ${rate}% p.a. (year slice)`
          : `RB ${rate}% p.a. ÷ 12 (month slice)`,
      proRataFactor,
    };
  }

  // straight_line
  const life = asset.useful_life_months;
  if (life == null || life <= 0) {
    return { ok: false, error: "Straight-line requires useful life (months)." };
  }
  const depreciableBase = Math.max(0, asset.cost - asset.residual_value);
  const perMonth = depreciableBase / life;
  const perYear = depreciableBase / (life / 12);

  let baseAmount =
    asset.depreciation_frequency === "yearly"
      ? perYear
      : perMonth;

  baseAmount = roundMoney(baseAmount * proRataFactor);
  baseAmount = Math.min(baseAmount, depreciable);
  return {
    ok: true,
    amount: baseAmount,
    note:
      asset.depreciation_frequency === "yearly"
        ? `SL: (${depreciableBase}) / ${(life / 12).toFixed(2)} yr`
        : `SL: (${depreciableBase}) / ${life} mo`,
    proRataFactor,
  };
}
