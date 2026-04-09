export type DateRangeKey =
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

/** Inclusive start, exclusive end [from, to) in local time semantics matching the original Reports page. */
export function computeReportRange(key: DateRangeKey, customFrom: string, customTo: string): { from: Date; to: Date } {
  const today = new Date();
  const startOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const addDays = (d: Date, days: number) => {
    const x = new Date(d);
    x.setDate(x.getDate() + days);
    return x;
  };

  let from: Date;
  let to: Date;

  switch (key) {
    case "today": {
      from = startOfDay(today);
      to = addDays(from, 1);
      break;
    }
    case "yesterday": {
      from = addDays(startOfDay(today), -1);
      to = startOfDay(today);
      break;
    }
    case "this_week": {
      const d = startOfDay(today);
      const day = d.getDay();
      const diff = (day + 6) % 7;
      from = addDays(d, -diff);
      to = addDays(from, 7);
      break;
    }
    case "last_week": {
      const d = startOfDay(today);
      const day = d.getDay();
      const diff = (day + 6) % 7;
      const thisWeekStart = addDays(d, -diff);
      from = addDays(thisWeekStart, -7);
      to = thisWeekStart;
      break;
    }
    case "this_month": {
      from = new Date(today.getFullYear(), today.getMonth(), 1);
      to = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      break;
    }
    case "last_month": {
      from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      to = new Date(today.getFullYear(), today.getMonth(), 1);
      break;
    }
    case "this_quarter": {
      const q = Math.floor(today.getMonth() / 3);
      const startMonth = q * 3;
      from = new Date(today.getFullYear(), startMonth, 1);
      to = new Date(today.getFullYear(), startMonth + 3, 1);
      break;
    }
    case "last_quarter": {
      const q = Math.floor(today.getMonth() / 3);
      const startMonth = (q - 1) * 3;
      const year = q === 0 ? today.getFullYear() - 1 : today.getFullYear();
      const start = new Date(year, (startMonth + 12) % 12, 1);
      from = start;
      to = new Date(start.getFullYear(), start.getMonth() + 3, 1);
      break;
    }
    case "this_year": {
      from = new Date(today.getFullYear(), 0, 1);
      to = new Date(today.getFullYear() + 1, 0, 1);
      break;
    }
    case "last_year": {
      from = new Date(today.getFullYear() - 1, 0, 1);
      to = new Date(today.getFullYear(), 0, 1);
      break;
    }
    case "custom":
    default: {
      if (!customFrom || !customTo) {
        const d = startOfDay(today);
        from = d;
        to = addDays(d, 1);
      } else {
        from = startOfDay(new Date(customFrom));
        to = addDays(startOfDay(new Date(customTo)), 1);
      }
    }
  }

  return { from, to };
}
