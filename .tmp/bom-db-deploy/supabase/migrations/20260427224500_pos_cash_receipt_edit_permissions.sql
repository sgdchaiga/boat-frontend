-- Role-type permissions for POS order and cash receipt edits.
ALTER TABLE public.organization_role_types
ADD COLUMN IF NOT EXISTS can_edit_pos_orders boolean NOT NULL DEFAULT false;

ALTER TABLE public.organization_role_types
ADD COLUMN IF NOT EXISTS can_edit_cash_receipts boolean NOT NULL DEFAULT false;

-- Keep existing expected behavior for common management/finance roles.
UPDATE public.organization_role_types
SET can_edit_pos_orders = true
WHERE role_key IN ('admin', 'manager', 'accountant', 'supervisor');

UPDATE public.organization_role_types
SET can_edit_cash_receipts = true
WHERE role_key IN ('admin', 'manager', 'accountant', 'supervisor');

-- Tighten retail POS edit permissions (server-side).
DROP POLICY IF EXISTS "retail_sales_write_same_org" ON public.retail_sales;
DROP POLICY IF EXISTS "retail_sale_lines_write_same_org" ON public.retail_sale_lines;

CREATE POLICY "retail_sales_insert_same_org"
  ON public.retail_sales FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IS NOT NULL
    AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
  );

CREATE POLICY "retail_sales_update_delete_authorized"
  ON public.retail_sales FOR UPDATE
  TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
      AND EXISTS (
        SELECT 1
        FROM public.staff me
        JOIN public.organization_role_types rt
          ON rt.organization_id = me.organization_id
         AND rt.role_key = me.role
        WHERE me.id = auth.uid()
          AND (rt.can_edit_pos_orders = true OR me.role IN ('admin', 'manager', 'accountant', 'supervisor'))
      )
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (
      organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
      AND EXISTS (
        SELECT 1
        FROM public.staff me
        JOIN public.organization_role_types rt
          ON rt.organization_id = me.organization_id
         AND rt.role_key = me.role
        WHERE me.id = auth.uid()
          AND (rt.can_edit_pos_orders = true OR me.role IN ('admin', 'manager', 'accountant', 'supervisor'))
      )
    )
  );

CREATE POLICY "retail_sales_delete_authorized"
  ON public.retail_sales FOR DELETE
  TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
      AND EXISTS (
        SELECT 1
        FROM public.staff me
        JOIN public.organization_role_types rt
          ON rt.organization_id = me.organization_id
         AND rt.role_key = me.role
        WHERE me.id = auth.uid()
          AND (rt.can_edit_pos_orders = true OR me.role IN ('admin', 'manager', 'accountant', 'supervisor'))
      )
    )
  );

CREATE POLICY "retail_sale_lines_insert_same_org"
  ON public.retail_sale_lines FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.retail_sales rs
      WHERE rs.id = retail_sale_lines.sale_id
        AND rs.organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
    )
  );

CREATE POLICY "retail_sale_lines_update_authorized"
  ON public.retail_sale_lines FOR UPDATE
  TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      EXISTS (
        SELECT 1
        FROM public.retail_sales rs
        JOIN public.staff me ON me.organization_id = rs.organization_id AND me.id = auth.uid()
        JOIN public.organization_role_types rt ON rt.organization_id = me.organization_id AND rt.role_key = me.role
        WHERE rs.id = retail_sale_lines.sale_id
          AND (rt.can_edit_pos_orders = true OR me.role IN ('admin', 'manager', 'accountant', 'supervisor'))
      )
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (
      EXISTS (
        SELECT 1
        FROM public.retail_sales rs
        JOIN public.staff me ON me.organization_id = rs.organization_id AND me.id = auth.uid()
        JOIN public.organization_role_types rt ON rt.organization_id = me.organization_id AND rt.role_key = me.role
        WHERE rs.id = retail_sale_lines.sale_id
          AND (rt.can_edit_pos_orders = true OR me.role IN ('admin', 'manager', 'accountant', 'supervisor'))
      )
    )
  );

CREATE POLICY "retail_sale_lines_delete_authorized"
  ON public.retail_sale_lines FOR DELETE
  TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      EXISTS (
        SELECT 1
        FROM public.retail_sales rs
        JOIN public.staff me ON me.organization_id = rs.organization_id AND me.id = auth.uid()
        JOIN public.organization_role_types rt ON rt.organization_id = me.organization_id AND rt.role_key = me.role
        WHERE rs.id = retail_sale_lines.sale_id
          AND (rt.can_edit_pos_orders = true OR me.role IN ('admin', 'manager', 'accountant', 'supervisor'))
      )
    )
  );

-- Tighten payment edit permissions (used by Cash Receipts edits/reversals).
DROP POLICY IF EXISTS "payments_manage_same_org_receptionist_plus" ON public.payments;

CREATE POLICY "payments_insert_same_org_frontdesk_plus"
  ON public.payments FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (
      organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
      AND EXISTS (
        SELECT 1
        FROM public.staff me
        WHERE me.id = auth.uid()
          AND me.role IN ('admin', 'manager', 'receptionist', 'accountant', 'supervisor')
      )
    )
  );

CREATE POLICY "payments_update_authorized"
  ON public.payments FOR UPDATE
  TO authenticated
  USING (
    public.is_platform_admin()
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
            OR me.role IN ('admin', 'manager', 'accountant', 'supervisor')
          )
      )
    )
  )
  WITH CHECK (
    public.is_platform_admin()
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
            OR me.role IN ('admin', 'manager', 'accountant', 'supervisor')
          )
      )
    )
  );

CREATE POLICY "payments_delete_authorized"
  ON public.payments FOR DELETE
  TO authenticated
  USING (
    public.is_platform_admin()
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
            OR me.role IN ('admin', 'manager', 'accountant', 'supervisor')
          )
      )
    )
  );
