-- Organization admins may manage staff page visibility, but report-page
-- visibility is reserved for platform super admins.
DROP POLICY IF EXISTS "staff_permission_overrides_manage_admin"
  ON public.staff_permission_overrides;

CREATE POLICY "staff_permission_overrides_manage_admin"
  ON public.staff_permission_overrides FOR ALL
  TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
      AND EXISTS (
        SELECT 1
        FROM public.staff me
        WHERE me.id = auth.uid()
          AND me.role = 'admin'
      )
      AND permission_key NOT LIKE 'page:reports%'
      AND permission_key <> 'page:hotel_pos_reports'
      AND permission_key <> 'page:retail_credit_sales_report'
      AND permission_key <> 'page:accounting_trial'
      AND permission_key <> 'page:accounting_income'
      AND permission_key <> 'page:accounting_balance'
      AND permission_key <> 'page:accounting_cashflow'
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (
      organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
      AND EXISTS (
        SELECT 1
        FROM public.staff me
        WHERE me.id = auth.uid()
          AND me.role = 'admin'
      )
      AND permission_key NOT LIKE 'page:reports%'
      AND permission_key <> 'page:hotel_pos_reports'
      AND permission_key <> 'page:retail_credit_sales_report'
      AND permission_key <> 'page:accounting_trial'
      AND permission_key <> 'page:accounting_income'
      AND permission_key <> 'page:accounting_balance'
      AND permission_key <> 'page:accounting_cashflow'
    )
  );
