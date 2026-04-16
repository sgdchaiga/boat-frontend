/**
 * Business timezone: Uganda (Africa/Kampala) = GMT+3
 * All date ranges (today, this week, etc.) are computed in this timezone
 * so reports match the local business day regardless of server/DB (UTC).
 */
const BUSINESS_TIMEZONE = "Africa/Kampala";

/**
 * Calendar date (YYYY-MM-DD) in the business timezone for a given instant or ISO timestamp.
 * Use for journal entry_date so reports (which use Kampala ranges) include the same business day.
 */
export function toBusinessDateString(input: string | Date): string {
  let d: Date;
  if (input instanceof Date) {
    d = input;
  } else {
    const s = input.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      d = new Date(s + "T12:00:00.000Z");
    } else {
      d = new Date(s);
    }
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Today's date string in business timezone (for defaults and journal posting). */
export function businessTodayISO(): string {
  return toBusinessDateString(new Date());
}

/** Get the current date (year, month, day) in business timezone */
function getBusinessDate(now: Date): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const year = parseInt(parts.find((p) => p.type === "year")!.value, 10);
  const month = parseInt(parts.find((p) => p.type === "month")!.value, 10) - 1;
  const day = parseInt(parts.find((p) => p.type === "day")!.value, 10);
  return { year, month, day };
}

/** Start of a date in Uganda (00:00 EAT) as a UTC Date */
function startOfDayUTC(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day, -3, 0, 0, 0));
}

/** Add days to a UTC Date (for range end) */
function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

export type DateRangeKey =
  | "last_24_hours"
  | "last_7_days"
  | "last_30_days"
  | "today"
  | "yesterday"
  | "this_week"
  | "this_month"
  | "this_quarter"
  | "this_year"
  | "last_week"
  | "last_month"
  | "last_quarter"
  | "last_year"
  | "custom";

export function computeRangeInTimezone(
  key: DateRangeKey,
  customFrom: string,
  customTo: string
): { from: Date; to: Date } {
  const now = new Date();
  const { year, month, day } = getBusinessDate(now);

  let from: Date;
  let to: Date;

  switch (key) {
    case "last_24_hours": {
      to = new Date(Date.now() + 2 * 60 * 1000); // 2 min buffer to include just-created orders
      from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
      break;
    }
    case "last_7_days": {
      to = new Date(Date.now() + 2 * 60 * 1000);
      from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    }
    case "last_30_days": {
      to = new Date(Date.now() + 2 * 60 * 1000);
      from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    }
    case "today": {
      from = startOfDayUTC(year, month, day);
      to = addDays(from, 1);
      break;
    }
    case "yesterday": {
      const todayStart = startOfDayUTC(year, month, day);
      from = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
      to = todayStart;
      break;
    }
    case "this_week": {
      const d = startOfDayUTC(year, month, day);
      const dow = new Date(d.getTime() + 3 * 60 * 60 * 1000).getUTCDay();
      const diff = (dow + 6) % 7;
      from = addDays(d, -diff);
      to = addDays(from, 7);
      break;
    }
    case "last_week": {
      const d = startOfDayUTC(year, month, day);
      const dow = new Date(d.getTime() + 3 * 60 * 60 * 1000).getUTCDay();
      const diff = (dow + 6) % 7;
      const thisWeekStart = addDays(d, -diff);
      from = addDays(thisWeekStart, -7);
      to = thisWeekStart;
      break;
    }
    case "this_month":
      from = startOfDayUTC(year, month, 1);
      to = startOfDayUTC(year, month + 1, 1);
      break;
    case "last_month":
      from = startOfDayUTC(year, month - 1, 1);
      to = startOfDayUTC(year, month, 1);
      break;
    case "this_quarter": {
      const q = Math.floor(month / 3);
      const startMonth = q * 3;
      from = startOfDayUTC(year, startMonth, 1);
      to = startOfDayUTC(year, startMonth + 3, 1);
      break;
    }
    case "last_quarter": {
      const q = Math.floor(month / 3);
      const startMonth = (q - 1) * 3;
      const m = (startMonth + 12) % 12;
      const y = startMonth < 0 ? year - 1 : year;
      from = startOfDayUTC(y, m, 1);
      to = startOfDayUTC(y, m + 3, 1);
      break;
    }
    case "this_year":
      from = startOfDayUTC(year, 0, 1);
      to = startOfDayUTC(year + 1, 0, 1);
      break;
    case "last_year":
      from = startOfDayUTC(year - 1, 0, 1);
      to = startOfDayUTC(year, 0, 1);
      break;
    case "custom":
    default:
      if (customFrom && customTo) {
        const [fy, fm, fd] = customFrom.split("-").map(Number);
        const [ty, tm, td] = customTo.split("-").map(Number);
        from = startOfDayUTC(fy, fm - 1, fd);
        to = addDays(startOfDayUTC(ty, tm - 1, td), 1);
      } else {
        from = startOfDayUTC(year, month, day);
        to = addDays(from, 1);
      }
  }
  return { from, to };
}

/**
 * Calendar day in business timezone (YYYY-MM-DD) → [start, end) UTC for filtering `paid_at` / timestamps.
 */
export function businessDayRangeForDateString(yyyyMmDd: string): { from: Date; to: Date } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd.trim());
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1;
  const day = parseInt(m[3], 10);
  const from = startOfDayUTC(year, month, day);
  return { from, to: addDays(from, 1) };
}
