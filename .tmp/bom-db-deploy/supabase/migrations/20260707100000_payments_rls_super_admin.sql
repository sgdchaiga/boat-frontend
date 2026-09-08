-- Allow organization super admins to post and edit payment rows.
-- The earlier POS/cash receipt payment policies predate the org-level
-- `super_admin` role and only recognize legacy staff roles.

DROP POLICY IF EXISTS "payments_insert_same_org_frontdesk_plus" ON public.payments;
DROP POLICY IF EXISTS "payments_select_same_org" ON public.payments;
DROP POLICY IF EXISTS "payments_update_authorized" ON public.payments;
DROP POLICY IF EXISTS "payments_delete_authorized" ON public.payments;

CREATE POLICY "payments_select_same_org"
  ON public.payments FOR SELECT
  TO authenticated
  USING (
    public.is_platform_admin()
    OR public.caller_is_org_super_admin_for(organization_id)
    OR organization_id = public.auth_organization_id()
  );

CREATE POLICY "payments_insert_same_org_frontdesk_plus"
  ON public.payments FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR public.caller_is_org_super_admin_for(organization_id)
    OR (
      organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
      AND EXISTS (
        SELECT 1
        FROM public.staff me
        WHERE me.id = auth.uid()
          AND me.role IN ('admin', 'manager', 'receptionist', 'accountant', 'supervisor', 'super_admin')
      )
    )
  );

CREATE POLICY "payments_update_authorized"
  ON public.payments FOR UPDATE
  TO authenticated
  USING (
    public.is_platform_admin()
    OR public.caller_is_org_super_admin_for(organization_id)
    OR (
      organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
      AND EXISTS (
        SELECT 1
        FROM public.staff me
        JOIN public.organization_role_types rt
          ON rt.organization_id = me.organization_id
         AND rt.role_key = me.role
        WHERE me.id = auth.uid()
          AND (
            rt.can_edit_cash_receipts = true
            OR me.role IN ('admin', 'manager', 'accountant', 'supervisor', 'super_admin')
          )
      )
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR public.caller_is_org_super_admin_for(organization_id)
    OR (
      organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
      AND EXISTS (
        SELECT 1
        FROM public.staff me
        JOIN public.organization_role_types rt
          ON rt.organization_id = me.organization_id
         AND rt.role_key = me.role
        WHERE me.id = auth.uid()
          AND (
            rt.can_edit_cash_receipts = true
            OR me.role IN ('admin', 'manager', 'accountant', 'supervisor', 'super_admin')
          )
      )
    )
  );

CREATE POLICY "payments_delete_authorized"
  ON public.payments FOR DELETE
  TO authenticated
  USING (
    public.is_platform_admin()
    OR public.caller_is_org_super_admin_for(organization_id)
    OR (
      organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
      AND EXISTS (
        SELECT 1
        FROM public.staff me
        JOIN public.organization_role_types rt
          ON rt.organization_id = me.organization_id
         AND rt.role_key = me.role
        WHERE me.id = auth.uid()
          AND (
            rt.can_edit_cash_receipts = true
            OR me.role IN ('admin', 'manager', 'accountant', 'supervisor', 'super_admin')
          )
      )
    )
  );
