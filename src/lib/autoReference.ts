import type { SupabaseClient } from "@supabase/supabase-js";

/** 2-digit page codes for auto references (01 school fees, 02 wallet). */
export const AUTO_REF_PAGE_SCHOOL_FEES = "01";
export const AUTO_REF_PAGE_WALLET = "02";

/** UTC calendar day: `YYYYMMDD` + ISO bounds for DB filters. */
export function utcTodayParts(): { dateStr: string; dayStartIso: string; dayEndIso: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const mo = now.getUTCMonth();
  const d = now.getUTCDate();
  const dateStr = `${y}${String(mo + 1).padStart(2, "0")}${String(d).padStart(2, "0")}`;
  const dayStartIso = new Date(Date.UTC(y, mo, d, 0, 0, 0, 0)).toISOString();
  const dayEndIso = new Date(Date.UTC(y, mo, d, 23, 59, 59, 999)).toISOString();
  return { dateStr, dayStartIso, dayEndIso };
}

/** `01-20260406-001` — page (2 digits), date, sequence for that page/org/day. */
export function formatAutoReference(pageCode: string, dateStr: string, seq: number): string {
  const p = pageCode.replace(/\D/g, "").slice(0, 2).padStart(2, "0");
  return `${p}-${dateStr}-${String(seq).padStart(3, "0")}`;
}

/** Next sequence = count of rows today (UTC) + 1. */
export async function nextReferenceSequence(
  supabase: SupabaseClient,
  table: "school_payments" | "wallet_transactions",
  orgId: string,
  dateColumn: "paid_at" | "created_at"
): Promise<number> {
  const { dayStartIso, dayEndIso } = utcTodayParts();
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .gte(dateColumn, dayStartIso)
    .lte(dateColumn, dayEndIso);
  if (error) throw new Error(error.message);
  return (count ?? 0) + 1;
}

export async function buildSchoolFeesAutoReference(supabase: SupabaseClient, orgId: string): Promise<string> {
  const { dateStr } = utcTodayParts();
  const seq = await nextReferenceSequence(supabase, "school_payments", orgId, "paid_at");
  return formatAutoReference(AUTO_REF_PAGE_SCHOOL_FEES, dateStr, seq);
}

export async function buildWalletAutoReference(supabase: SupabaseClient, orgId: string): Promise<string> {
  const { dateStr } = utcTodayParts();
  const seq = await nextReferenceSequence(supabase, "wallet_transactions", orgId, "created_at");
  return formatAutoReference(AUTO_REF_PAGE_WALLET, dateStr, seq);
}
