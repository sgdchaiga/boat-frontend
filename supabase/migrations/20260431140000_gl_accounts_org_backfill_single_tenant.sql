-- Backfill gl_accounts.organization_id when NULL and only one organization exists.
-- Legacy rows (SQL imports without org) could not match RLS (equality with NULL is never true).

UPDATE public.gl_accounts
SET organization_id = (SELECT id FROM public.organizations LIMIT 1)
WHERE organization_id IS NULL
  AND (SELECT COUNT(*)::int FROM public.organizations) = 1;
