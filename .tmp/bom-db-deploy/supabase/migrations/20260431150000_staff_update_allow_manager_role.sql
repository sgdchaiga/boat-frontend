-- Allow managers (same org) to insert/update staff, not only role_key = 'admin'.
-- staff.role stores organization_role_types.role_key; many orgs delegate HR to managers.

DROP POLICY IF EXISTS "staff_insert_same_org_admin" ON public.staff;
DROP POLICY IF EXISTS "staff_update_same_org_admin" ON public.staff;

CREATE POLICY "staff_insert_same_org_admin"
  ON public.staff FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff me
      WHERE me.id = auth.uid()
        AND me.role IN ('admin', 'manager')
        AND me.organization_id IS NOT NULL
    )
    AND organization_id = (
      SELECT me.organization_id FROM public.staff me WHERE me.id = auth.uid()
    )
  );

CREATE POLICY "staff_update_same_org_admin"
  ON public.staff FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.staff me
      WHERE me.id = auth.uid()
        AND me.role IN ('admin', 'manager')
        AND me.organization_id IS NOT NULL
    )
    AND organization_id = (
      SELECT me.organization_id FROM public.staff me WHERE me.id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff me
      WHERE me.id = auth.uid()
        AND me.role IN ('admin', 'manager')
        AND me.organization_id IS NOT NULL
    )
    AND organization_id = (
      SELECT me.organization_id FROM public.staff me WHERE me.id = auth.uid()
    )
  );
