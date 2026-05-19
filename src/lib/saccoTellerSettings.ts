/**
 * SACCO teller org settings (insured till limit on journal_gl_settings).
 */
import { supabase } from "@/lib/supabase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

function isUnknownColumn(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "PGRST204") return true;
  const m = err.message ?? "";
  return m.includes("Could not find") && m.includes("column");
}

export async function fetchSaccoTillInsuredLimit(organizationId: string): Promise<number | null> {
  const { data, error } = await sb
    .from("journal_gl_settings")
    .select("sacco_till_insured_limit_ugx")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) {
    if (isUnknownColumn(error)) {
      console.warn(
        "[SACCO] sacco_till_insured_limit_ugx missing — run migration 20260518120000_sacco_till_insured_limit.sql"
      );
      return null;
    }
    throw error;
  }
  const raw = (data as { sacco_till_insured_limit_ugx?: unknown } | null)?.sacco_till_insured_limit_ugx;
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function upsertSaccoTillInsuredLimit(
  organizationId: string,
  limitUgx: number | null
): Promise<void> {
  const value =
    limitUgx === null || !Number.isFinite(limitUgx) || limitUgx < 0 ? null : Math.round(limitUgx);
  const { error } = await sb.from("journal_gl_settings").upsert(
    {
      organization_id: organizationId,
      sacco_till_insured_limit_ugx: value,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id" }
  );
  if (error && isUnknownColumn(error)) {
    throw new Error(
      "Till insured limit column is missing. Run migration 20260518120000_sacco_till_insured_limit.sql on Supabase."
    );
  }
  if (error) throw error;
}
