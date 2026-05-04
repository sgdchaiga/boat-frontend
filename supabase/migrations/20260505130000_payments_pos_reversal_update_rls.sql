-- Allow POS order reversals to mark linked payments refunded for users with pos_orders_edit
-- (same capability as retail_sale_lines delete/insert), not only cash_receipts editors.

DROP POLICY IF EXISTS "payments_update_authorized" ON public.payments;

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
    OR (
      organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
      AND payment_source = 'pos_retail'
      AND transaction_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.retail_sales rs
        WHERE rs.organization_id = payments.organization_id
          AND trim(both from rs.id::text) = trim(both from payments.transaction_id::text)
      )
      AND public.staff_has_pos_orders_edit(payments.organization_id, auth.uid())
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
    OR (
      organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
      AND payment_source = 'pos_retail'
      AND transaction_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.retail_sales rs
        WHERE rs.organization_id = payments.organization_id
          AND trim(both from rs.id::text) = trim(both from payments.transaction_id::text)
      )
      AND public.staff_has_pos_orders_edit(payments.organization_id, auth.uid())
    )
  );
