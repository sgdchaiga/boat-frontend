-- Tighten billing edit permissions server-side.
-- Keep broad read access within org, allow inserts for frontdesk roles,
-- but restrict updates/deletes to authorized finance/management roles.

DROP POLICY IF EXISTS "billing_manage_same_org_receptionist_plus" ON public.billing;

CREATE POLICY "billing_insert_same_org_frontdesk_plus"
  ON public.billing FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (
      EXISTS (
        SELECT 1
        FROM public.staff s
        WHERE s.id = auth.uid()
          AND s.role IN ('admin', 'manager', 'receptionist', 'accountant', 'supervisor')
      )
      AND organization_id = (
        SELECT s.organization_id
        FROM public.staff s
        WHERE s.id = auth.uid()
      )
    )
  );

CREATE POLICY "billing_update_same_org_authorized_roles"
  ON public.billing FOR UPDATE
  TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      EXISTS (
        SELECT 1
        FROM public.staff s
        WHERE s.id = auth.uid()
          AND s.role IN ('admin', 'manager', 'accountant', 'supervisor')
      )
      AND organization_id = (
        SELECT s.organization_id
        FROM public.staff s
        WHERE s.id = auth.uid()
      )
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (
      EXISTS (
        SELECT 1
        FROM public.staff s
        WHERE s.id = auth.uid()
          AND s.role IN ('admin', 'manager', 'accountant', 'supervisor')
      )
      AND organization_id = (
        SELECT s.organization_id
        FROM public.staff s
        WHERE s.id = auth.uid()
      )
    )
  );

CREATE POLICY "billing_delete_same_org_authorized_roles"
  ON public.billing FOR DELETE
  TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      EXISTS (
        SELECT 1
        FROM public.staff s
        WHERE s.id = auth.uid()
          AND s.role IN ('admin', 'manager', 'accountant', 'supervisor')
      )
      AND organization_id = (
        SELECT s.organization_id
        FROM public.staff s
        WHERE s.id = auth.uid()
      )
    )
  );
