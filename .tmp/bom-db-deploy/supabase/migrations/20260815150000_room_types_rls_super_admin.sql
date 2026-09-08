-- Room-type setup policy predates the organization super_admin role. Permit
-- active hotel managers/admins, organization super admins, and platform admins
-- while retaining strict organization isolation.
DROP POLICY IF EXISTS "room_types_manage_same_org_managers" ON public.room_types;

CREATE POLICY "room_types_manage_same_org_managers"
  ON public.room_types FOR ALL
  TO authenticated
  USING (
    public.is_platform_admin()
    OR public.caller_is_org_super_admin_for(organization_id)
    OR EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id=auth.uid()
        AND s.organization_id=room_types.organization_id
        AND COALESCE(s.is_active,true)
        AND lower(COALESCE(s.role,'')) IN ('admin','manager','super_admin')
    )
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND (
      public.is_platform_admin()
      OR public.caller_is_org_super_admin_for(organization_id)
      OR EXISTS (
        SELECT 1 FROM public.staff s
        WHERE s.id=auth.uid()
          AND s.organization_id=room_types.organization_id
          AND COALESCE(s.is_active,true)
          AND lower(COALESCE(s.role,'')) IN ('admin','manager','super_admin')
      )
    )
  );
