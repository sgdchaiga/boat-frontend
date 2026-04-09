import { supabase } from "@/lib/supabase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

/** PostgREST / Postgres when the table has not been migrated yet. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isMissingRelationError(error: any): boolean {
  if (!error) return false;
  if (error.status === 404 || error.status === 406) return true;
  const m = String(error.message ?? error.details ?? "").toLowerCase();
  if (m.includes("does not exist") || m.includes("schema cache") || m.includes("could not find the table")) return true;
  const c = String(error.code ?? "");
  if (c === "42P01" || c === "PGRST205" || c === "PGRST204") return true;
  return false;
}

const MISSING_TABLE_MSG =
  "Table sacco_savings_product_types is missing. In Supabase: SQL Editor → run migration file 20260426120006_sacco_savings_product_types.sql (or supabase db push).";

export type SaccoSavingsProductTypeRow = {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type FetchSavingsProductTypesResult = {
  rows: SaccoSavingsProductTypeRow[];
  /** True when PostgREST returned 404 / relation missing — apply migration `20260426120006`. */
  tableMissing: boolean;
};

export async function fetchSavingsProductTypes(organizationId: string): Promise<FetchSavingsProductTypesResult> {
  const { data, error } = await sb
    .from("sacco_savings_product_types")
    .select("*")
    .eq("organization_id", organizationId)
    .order("sort_order", { ascending: true })
    .order("code", { ascending: true });
  if (error) {
    if (isMissingRelationError(error)) {
      console.warn(
        "[SACCO] Table sacco_savings_product_types is missing — run migration 20260426120006_sacco_savings_product_types.sql on Supabase."
      );
      return { rows: [], tableMissing: true };
    }
    throw error;
  }
  return { rows: (data ?? []) as SaccoSavingsProductTypeRow[], tableMissing: false };
}

export async function insertSavingsProductType(
  organizationId: string,
  row: { code: string; name: string; description?: string | null; sort_order?: number }
): Promise<void> {
  const code = String(row.code ?? "")
    .trim()
    .replace(/\s+/g, "");
  if (!code) throw new Error("Code is required.");
  const { error } = await sb.from("sacco_savings_product_types").insert({
    organization_id: organizationId,
    code,
    name: row.name.trim() || code,
    description: row.description?.trim() || null,
    sort_order: row.sort_order ?? 0,
    is_active: true,
  });
  if (error) {
    if (isMissingRelationError(error)) throw new Error(MISSING_TABLE_MSG);
    throw error;
  }
}

export async function updateSavingsProductType(
  id: string,
  patch: Partial<Pick<SaccoSavingsProductTypeRow, "code" | "name" | "description" | "is_active" | "sort_order">>
): Promise<void> {
  const { error } = await sb.from("sacco_savings_product_types").update(patch).eq("id", id);
  if (error) {
    if (isMissingRelationError(error)) throw new Error(MISSING_TABLE_MSG);
    throw error;
  }
}

export async function deleteSavingsProductType(id: string): Promise<void> {
  const { error } = await sb.from("sacco_savings_product_types").delete().eq("id", id);
  if (error) {
    if (isMissingRelationError(error)) throw new Error(MISSING_TABLE_MSG);
    throw error;
  }
}
