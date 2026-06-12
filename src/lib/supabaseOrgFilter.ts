/**
 * Extra `.eq('organization_id', …)` for tenant tables when the signed-in user
 * is property staff. Skipped for platform super-admins (RLS already widens access).
 *
 * **Do not use for `gl_accounts` reads.** Row-level security already matches
 * `staff.organization_id` to `gl_accounts.organization_id`. Adding `.eq` here
 * excludes rows with `organization_id` NULL (legacy imports / seeds), so
 * journal pickers and Chart of Accounts appear empty. Query `gl_accounts` without
 * this helper and rely on RLS only.
 *
 * **Do not use for `journal_entry_lines`.** That table has no `organization_id`
 * column in the standard schema (tenant lives on `journal_entries`). PostgREST
 * returns 400 if you filter on a missing column. Use `filterJournalLinesByOrganizationId`
 * for line queries that embed `journal_entries`, or omit an org filter when lines
 * are already constrained by `journal_entry_id` lists from org-scoped `journal_entries` queries.
 *
 * Generic `T` preserves the Postgrest builder type (avoids TS2589 / losing `.data` / `.single()`).
 */
export function filterByOrganizationId<T>(
  query: T,
  organizationId: string | null | undefined,
  isSuperAdmin?: boolean
): T {
  if (isSuperAdmin) return query;
  if (!organizationId) return query;
  return (query as T & { eq: (column: string, value: string) => T }).eq("organization_id", organizationId);
}

/**
 * Tenant scope for `journal_entry_lines` when the query embeds `journal_entries`
 * (e.g. `journal_entries!inner(...)`). Organization is stored on the header row, not on lines.
 * An explicitly selected organization always scopes journal reports, including for platform admins.
 */
/**
 * Stock movements: always filter by organization when an id is provided
 * (including super-admin) so balances and adjustment history match the active workspace.
 */
export function filterStockMovementsByOrganizationId<T>(
  query: T,
  organizationId: string | null | undefined
): T {
  if (!organizationId) return query;
  return (query as T & { eq: (column: string, value: string) => T }).eq("organization_id", organizationId);
}

export function filterJournalLinesByOrganizationId<T>(
  query: T,
  organizationId: string | null | undefined,
  _isSuperAdmin?: boolean
): T {
  if (!organizationId) return query;
  return (query as T & { eq: (column: string, value: string) => T }).eq(
    "journal_entries.organization_id",
    organizationId
  );
}
