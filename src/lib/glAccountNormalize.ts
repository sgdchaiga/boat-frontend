export type NormalizedGlAccount = {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  category: string | null;
  is_active: boolean;
};

export function normalizeGlAccountRow(row: Record<string, unknown>): NormalizedGlAccount {
  return {
    id: String(row.id ?? ""),
    account_code: String(row.account_code ?? row.code ?? ""),
    account_name: String(row.account_name ?? row.name ?? ""),
    account_type: String(row.account_type ?? row.type ?? "").toLowerCase(),
    category: row.category == null ? null : String(row.category),
    is_active: Boolean(row.is_active ?? true),
  };
}

export function normalizeGlAccountRows(rows: unknown[]): NormalizedGlAccount[] {
  return rows
    .map((row) => normalizeGlAccountRow((row || {}) as Record<string, unknown>))
    .filter((row) => row.id.length > 0);
}
