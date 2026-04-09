import type { SupabaseClient } from "@supabase/supabase-js";
import { netJournalActivity } from "@/lib/budgetActuals";

/** Net GL activity per account id for a date range (same rules as budgeting). */
export async function fetchJournalActualsByGlIds(
  supabase: SupabaseClient,
  orgId: string,
  fromStr: string,
  toStr: string,
  glIds: string[],
  accountTypeById: Map<string, string>
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (glIds.length === 0) return totals;
  for (const gid of glIds) totals.set(gid, 0);

  const entryIds: string[] = [];
  const pageSize = 1000;
  let offset = 0;
  for (;;) {
    const { data: batch, error: e1 } = await supabase
      .from("journal_entries")
      .select("id")
      .eq("organization_id", orgId)
      .gte("entry_date", fromStr)
      .lte("entry_date", toStr)
      .order("entry_date", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (e1) throw e1;
    const rows = (batch || []) as { id: string }[];
    if (rows.length === 0) break;
    entryIds.push(...rows.map((r) => r.id));
    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  const chunk = 150;
  for (let i = 0; i < entryIds.length; i += chunk) {
    const ids = entryIds.slice(i, i + chunk);
    const { data: jels, error: e2 } = await supabase
      .from("journal_entry_lines")
      .select("gl_account_id, debit, credit")
      .in("journal_entry_id", ids)
      .in("gl_account_id", glIds);
    if (e2) throw e2;
    for (const row of jels || []) {
      const r = row as { gl_account_id: string; debit?: number; credit?: number };
      const at = accountTypeById.get(r.gl_account_id) || "expense";
      const net = netJournalActivity(Number(r.debit ?? 0), Number(r.credit ?? 0), at);
      totals.set(r.gl_account_id, (totals.get(r.gl_account_id) || 0) + net);
    }
  }
  return totals;
}
