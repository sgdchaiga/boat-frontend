/**
 * Suggested depreciation periods and “due” checks for auto-schedule reminders.
 * Dates are ISO YYYY-MM-DD (local calendar intent; avoid TZ edge cases by using noon UTC in parsers where needed).
 */

export type AutoDepreciationFrequency = "monthly" | "yearly";

export interface FixedAssetOrgSettingsRow {
  organization_id: string;
  auto_depreciation_enabled: boolean;
  auto_depreciation_frequency: AutoDepreciationFrequency;
  auto_depreciation_last_period_end: string | null;
  updated_at?: string;
}

/** Last calendar day of month (1–12). */
export function lastDayOfCalendarMonth(year: number, month1to12: number): string {
  const d = new Date(year, month1to12, 0);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISODate(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map((x) => parseInt(x, 10));
  return { y, m, d };
}

/** Inclusive add days using local date arithmetic. */
export function addDays(iso: string, days: number): string {
  const { y, m, d } = parseISODate(iso);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function addYears(iso: string, n: number): string {
  const { y, m, d } = parseISODate(iso);
  const dt = new Date(y + n, m - 1, d);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Next period after `lastPeriodEnd` (inclusive end date of the previous run).
 * Monthly: first day after last → through end of that month.
 * Yearly: 12 calendar months (same month/day span approximately).
 */
export function suggestNextPeriodAfter(
  lastPeriodEnd: string | null,
  frequency: AutoDepreciationFrequency
): { periodStart: string; periodEnd: string } {
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  if (!lastPeriodEnd) {
    if (frequency === "monthly") {
      const { y, m } = parseISODate(todayIso);
      const start = `${y}-${String(m).padStart(2, "0")}-01`;
      const end = lastDayOfCalendarMonth(y, m);
      return { periodStart: start, periodEnd: end };
    }
    const { y } = parseISODate(todayIso);
    const start = `${y}-01-01`;
    const end = `${y}-12-31`;
    return { periodStart: start, periodEnd: end };
  }

  const start = addDays(lastPeriodEnd, 1);
  const { y, m } = parseISODate(start);

  if (frequency === "monthly") {
    const end = lastDayOfCalendarMonth(y, m);
    return { periodStart: start, periodEnd: end };
  }

  const end = addDays(addYears(start, 1), -1);
  return { periodStart: start, periodEnd: end };
}

/** True if `todayIso` is on or after periodEnd (schedule is “due” for a reminder). */
export function isPeriodDue(todayIso: string, periodEnd: string): boolean {
  return todayIso >= periodEnd;
}
