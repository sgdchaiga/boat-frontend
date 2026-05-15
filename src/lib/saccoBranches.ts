import { supabase } from "@/lib/supabase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

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
  "Table sacco_branches is missing. In Supabase: SQL Editor → run migration 20260515120000_sacco_branches.sql (or supabase db push).";

export type SaccoBranchRow = {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
  is_default: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type FetchSaccoBranchesResult = {
  rows: SaccoBranchRow[];
  tableMissing: boolean;
};

export function normalizeBranchCode(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/\D/g, "");
}

export async function fetchSaccoBranches(organizationId: string): Promise<FetchSaccoBranchesResult> {
  const { data, error } = await sb
    .from("sacco_branches")
    .select("*")
    .eq("organization_id", organizationId)
    .order("sort_order", { ascending: true })
    .order("code", { ascending: true });
  if (error) {
    if (isMissingRelationError(error)) {
      console.warn("[SACCO] Table sacco_branches is missing — run migration 20260515120000_sacco_branches.sql.");
      return { rows: [], tableMissing: true };
    }
    throw error;
  }
  return { rows: (data ?? []) as SaccoBranchRow[], tableMissing: false };
}

export function pickDefaultBranchCode(rows: SaccoBranchRow[], fallback = "1"): string {
  const active = rows.filter((r) => r.is_active);
  const def = active.find((r) => r.is_default) ?? active[0];
  const code = def ? normalizeBranchCode(def.code) : "";
  return code || fallback;
}

export async function insertSaccoBranch(
  organizationId: string,
  row: { code: string; name: string; description?: string | null; sort_order?: number; is_default?: boolean }
): Promise<void> {
  const code = normalizeBranchCode(row.code);
  if (!code) throw new Error("Branch code is required.");
  if (row.is_default) {
    await sb.from("sacco_branches").update({ is_default: false }).eq("organization_id", organizationId);
  }
  const { error } = await sb.from("sacco_branches").insert({
    organization_id: organizationId,
    code,
    name: row.name.trim() || code,
    description: row.description?.trim() || null,
    sort_order: row.sort_order ?? 0,
    is_default: row.is_default ?? false,
    is_active: true,
  });
  if (error) {
    if (isMissingRelationError(error)) throw new Error(MISSING_TABLE_MSG);
    throw error;
  }
}

export async function updateSaccoBranch(
  id: string,
  organizationId: string,
  patch: Partial<Pick<SaccoBranchRow, "code" | "name" | "description" | "is_active" | "is_default" | "sort_order">>
): Promise<void> {
  if (patch.is_default) {
    await sb.from("sacco_branches").update({ is_default: false }).eq("organization_id", organizationId);
  }
  const next = { ...patch };
  if (next.code != null) next.code = normalizeBranchCode(next.code);
  const { error } = await sb.from("sacco_branches").update(next).eq("id", id);
  if (error) {
    if (isMissingRelationError(error)) throw new Error(MISSING_TABLE_MSG);
    throw error;
  }
}

export async function deleteSaccoBranch(id: string): Promise<void> {
  const { error } = await sb.from("sacco_branches").delete().eq("id", id);
  if (error) {
    if (isMissingRelationError(error)) throw new Error(MISSING_TABLE_MSG);
    throw error;
  }
}
