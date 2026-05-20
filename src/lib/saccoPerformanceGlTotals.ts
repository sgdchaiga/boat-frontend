import { supabase } from "@/lib/supabase";
import { filterJournalLinesByOrganizationId } from "@/lib/supabaseOrgFilter";
import { businessTodayISO } from "@/lib/timezone";

export type GlIncomeExpenseJournalLine = {
  debit: number;
  credit: number;
  gl_accounts: { account_type: string } | null;
  journal_entries: { entry_date: string } | null;
};

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Last six calendar months as `yyyy-mm` in the business timezone (Kampala), oldest first. */
export function lastSixBusinessMonths(): string[] {
  const today = businessTodayISO();
  const y0 = parseInt(today.slice(0, 4), 10);
  const m0 = parseInt(today.slice(5, 7), 10);
  const keys: string[] = [];
  for (let i = 5; i >= 0; i--) {
    let m = m0 - i;
    let y = y0;
    while (m < 1) {
      m += 12;
      y -= 1;
    }
    keys.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return keys;
}

/**
 * Posted journal lines hitting GL accounts typed `income` or `expense` (accrual / full GL, not cashbook).
 */
export async function fetchGlIncomeExpenseLines(
  organizationId: string | null,
  isSuperAdmin: boolean | undefined,
  fromDate: string,
  toDateInclusive: string
): Promise<{ lines: GlIncomeExpenseJournalLine[]; error: string | null }> {
  const q = supabase
    .from("journal_entry_lines")
    .select("debit, credit, gl_accounts!inner(account_type), journal_entries!inner(entry_date)")
    .gte("journal_entries.entry_date", fromDate)
    .lte("journal_entries.entry_date", toDateInclusive)
    .eq("journal_entries.is_posted", true)
    .in("gl_accounts.account_type", ["income", "expense"]);

  const linesQuery = filterJournalLinesByOrganizationId(q, organizationId, isSuperAdmin);
  const { data, error } = await linesQuery;
  if (error) return { lines: [], error: error.message };
  return { lines: (data ?? []) as GlIncomeExpenseJournalLine[], error: null };
}

export function totalsFromGlLines(
  lines: GlIncomeExpenseJournalLine[],
  range: { from: string; to: string }
): { income: number; expenses: number } {
  let income = 0;
  let expenses = 0;
  for (const l of lines) {
    const dt = (l.journal_entries?.entry_date ?? "").slice(0, 10);
    if (!dt || dt < range.from || dt > range.to) continue;
    const t = l.gl_accounts?.account_type;
    const dr = Number(l.debit) || 0;
    const cr = Number(l.credit) || 0;
    if (t === "income") income += cr - dr;
    else if (t === "expense") expenses += dr - cr;
  }
  return { income: roundMoney(income), expenses: roundMoney(expenses) };
}

export function monthlyIncomeExpenseFromGlLines(
  lines: GlIncomeExpenseJournalLine[],
  monthKeys: string[]
): { incomeByMonth: Map<string, number>; expenseByMonth: Map<string, number> } {
  const incomeByMonth = new Map<string, number>();
  const expenseByMonth = new Map<string, number>();
  for (const k of monthKeys) {
    incomeByMonth.set(k, 0);
    expenseByMonth.set(k, 0);
  }
  for (const l of lines) {
    const month = (l.journal_entries?.entry_date ?? "").slice(0, 7);
    if (!monthKeys.includes(month)) continue;
    const t = l.gl_accounts?.account_type;
    const dr = Number(l.debit) || 0;
    const cr = Number(l.credit) || 0;
    if (t === "income") {
      incomeByMonth.set(month, (incomeByMonth.get(month) ?? 0) + (cr - dr));
    } else if (t === "expense") {
      expenseByMonth.set(month, (expenseByMonth.get(month) ?? 0) + (dr - cr));
    }
  }
  for (const k of monthKeys) {
    incomeByMonth.set(k, roundMoney(incomeByMonth.get(k) ?? 0));
    expenseByMonth.set(k, roundMoney(expenseByMonth.get(k) ?? 0));
  }
  return { incomeByMonth, expenseByMonth };
}

/** Inclusive fetch window: selected date range plus data needed for the six-month trend chart. */
export function glFetchRangeForDashboard(from: string, to: string, trendMonthKeys: string[]): { from: string; to: string } {
  const trendStart = `${trendMonthKeys[0]}-01`;
  const bizToday = businessTodayISO();
  const wideFrom = from < trendStart ? from : trendStart;
  const wideTo = to > bizToday ? to : bizToday;
  return { from: wideFrom, to: wideTo };
}
