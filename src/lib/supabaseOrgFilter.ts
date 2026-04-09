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
