-- Allow platform admins to read gl_accounts (journal settings pickers, support).
-- Tenant staff still scoped by organization match; OR branch matches other tables.

DROP POLICY IF EXISTS "org_gl_accounts_select" ON public.gl_accounts;

CREATE POLICY "org_gl_accounts_select"
  ON public.gl_accounts
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1
      FROM public.staff s
      WHERE s.id = auth.uid()
        AND s.organization_id = gl_accounts.organization_id
    )
  );
