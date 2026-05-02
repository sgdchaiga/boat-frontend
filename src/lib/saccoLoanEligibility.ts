import type { LoanProduct, Member, SaccoLoanPolicy } from "@/types/saccoWorkspace";

/** Whole calendar days from `yyyy-mm-dd` to today (UTC date). */
export function calendarDaysElapsedSince(isoDate: string, ref = new Date()): number {
  const base = isoDate.trim().slice(0, 10);
  const [y, m, d] = base.split("-").map((x) => parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return -1;
  const r = ref.toISOString().slice(0, 10);
  const [y2, m2, d2] = r.split("-").map((x) => parseInt(x, 10));
  const t0 = Date.UTC(y, m - 1, d);
  const t1 = Date.UTC(y2, m2 - 1, d2);
  return Math.floor((t1 - t0) / 86400000);
}

export type DisbursePolicyResult = { ok: true } | { ok: false; reason: string };

/** SACCO disburse / new-application rule: ordinary savings existed long enough vs org policy default. */
export function memberMeetsLoanDisbursePolicy(member: Member | undefined, policy: SaccoLoanPolicy): DisbursePolicyResult {
  const minDays = Math.max(0, policy.minSavingsDaysBeforeLoan ?? 30);
  if (!member?.firstOrdinarySavingsOpenedAt) {
    return {
      ok: false,
      reason: `Member has no ordinary savings account on file. An account must be open at least ${minDays} full day(s) before loans can be disbursed.`,
    };
  }
  const elapsed = calendarDaysElapsedSince(member.firstOrdinarySavingsOpenedAt);
  if (elapsed < minDays) {
    return {
      ok: false,
      reason: `Cooling-off: first ordinary savings opened ${member.firstOrdinarySavingsOpenedAt}. Need ${minDays} full calendar day(s) elapsed (${elapsed} so far).`,
    };
  }
  return { ok: true };
}

export function loanProductSharesGate(
  member: Member | undefined,
  product: LoanProduct | undefined
): DisbursePolicyResult {
  if (!member || !product) return { ok: true };
  const minShr = Number(product.minimumShares ?? 0);
  if (minShr <= 0) return { ok: true };
  const have = Number(member.sharesBalance ?? 0);
  if (have < minShr) {
    return {
      ok: false,
      reason: `Product “${product.name}” requires at least ${minShr} UGX equivalent in share capital; member has ${have}.`,
    };
  }
  return { ok: true };
}
