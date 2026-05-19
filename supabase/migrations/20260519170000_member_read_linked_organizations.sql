-- Users with organization_members rows must read org name/type for the org picker and switcher.

DROP POLICY IF EXISTS "member_read_linked_organizations" ON public.organizations;

CREATE POLICY "member_read_linked_organizations"
  ON public.organizations FOR SELECT
  TO authenticated
  USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.user_id = auth.uid()
        AND om.organization_id = organizations.id
        AND om.is_active = true
    )
  );
