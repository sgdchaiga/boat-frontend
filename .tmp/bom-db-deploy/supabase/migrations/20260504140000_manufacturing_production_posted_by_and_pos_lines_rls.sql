-- POS order edits: staff_permission_overrides.pos_orders_edit must match retail_sales / retail_sale_lines policies,
-- otherwise DELETE returns 0 rows (no error) and re-insert duplicates lines.
CREATE OR REPLACE FUNCTION public.staff_has_pos_orders_edit(p_org_id uuid, p_staff_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.staff me
      JOIN public.organization_role_types rt
        ON rt.organization_id = me.organization_id
       AND rt.role_key = me.role
      WHERE me.id = p_staff_id
        AND me.organization_id = p_org_id
        AND (rt.can_edit_pos_orders = true OR me.role IN ('admin', 'manager', 'accountant', 'supervisor'))
    )
    OR EXISTS (
      SELECT 1
      FROM public.staff_permission_overrides spo
      WHERE spo.organization_id = p_org_id
        AND spo.staff_id = p_staff_id
        AND spo.permission_key = 'pos_orders_edit'
        AND spo.allowed IS TRUE
    );
$$;

REVOKE ALL ON FUNCTION public.staff_has_pos_orders_edit(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_has_pos_orders_edit(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "retail_sales_update_delete_authorized" ON public.retail_sales;
CREATE POLICY "retail_sales_update_delete_authorized"
  ON public.retail_sales FOR UPDATE
  TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
      AND public.staff_has_pos_orders_edit(organization_id, auth.uid())
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (
      organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
      AND public.staff_has_pos_orders_edit(organization_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "retail_sales_delete_authorized" ON public.retail_sales;
CREATE POLICY "retail_sales_delete_authorized"
  ON public.retail_sales FOR DELETE
  TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
      AND public.staff_has_pos_orders_edit(organization_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "retail_sale_lines_update_authorized" ON public.retail_sale_lines;
CREATE POLICY "retail_sale_lines_update_authorized"
  ON public.retail_sale_lines FOR UPDATE
  TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      EXISTS (
        SELECT 1
        FROM public.retail_sales rs
        WHERE rs.id = retail_sale_lines.sale_id
          AND public.staff_has_pos_orders_edit(rs.organization_id, auth.uid())
      )
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (
      EXISTS (
        SELECT 1
        FROM public.retail_sales rs
        WHERE rs.id = retail_sale_lines.sale_id
          AND public.staff_has_pos_orders_edit(rs.organization_id, auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "retail_sale_lines_delete_authorized" ON public.retail_sale_lines;
CREATE POLICY "retail_sale_lines_delete_authorized"
  ON public.retail_sale_lines FOR DELETE
  TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      EXISTS (
        SELECT 1
        FROM public.retail_sales rs
        WHERE rs.id = retail_sale_lines.sale_id
          AND public.staff_has_pos_orders_edit(rs.organization_id, auth.uid())
      )
    )
  );
