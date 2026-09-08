-- Restrict deletion of complete stock adjustment batches by unified staff permission.

INSERT INTO public.organization_permissions (organization_id, role_key, permission_key, allowed)
SELECT ort.organization_id, ort.role_key, 'stock_adjustments_delete', ort.role_key IN ('admin', 'manager')
FROM public.organization_role_types ort
ON CONFLICT (organization_id, role_key, permission_key) DO NOTHING;

-- Replace the broad ALL policy so adjustment deletion cannot bypass the permission RPC/UI.
DROP POLICY IF EXISTS "psm_write_same_org" ON public.product_stock_movements;
DROP POLICY IF EXISTS "psm_insert_same_org" ON public.product_stock_movements;
DROP POLICY IF EXISTS "psm_update_same_org" ON public.product_stock_movements;
DROP POLICY IF EXISTS "psm_delete_same_org" ON public.product_stock_movements;

CREATE POLICY "psm_insert_same_org"
  ON public.product_stock_movements FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (organization_id IS NOT NULL AND organization_id = public.auth_organization_id())
  );

CREATE POLICY "psm_update_same_org"
  ON public.product_stock_movements FOR UPDATE
  TO authenticated
  USING (
    public.is_platform_admin()
    OR (organization_id IS NOT NULL AND organization_id = public.auth_organization_id())
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (organization_id IS NOT NULL AND organization_id = public.auth_organization_id())
  );

CREATE POLICY "psm_delete_same_org"
  ON public.product_stock_movements FOR DELETE
  TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      organization_id IS NOT NULL
      AND organization_id = public.auth_organization_id()
      AND (
        source_type IS DISTINCT FROM 'adjustment'
        OR coalesce(
          (
            SELECT spo.allowed
            FROM public.staff_permission_overrides spo
            WHERE spo.organization_id = product_stock_movements.organization_id
              AND spo.staff_id = auth.uid()
              AND spo.permission_key = 'stock_adjustments_delete'
          ),
          (
            SELECT op.allowed
            FROM public.organization_permissions op
            JOIN public.staff s
              ON s.id = auth.uid()
             AND s.organization_id = op.organization_id
             AND s.role = op.role_key
            WHERE op.organization_id = product_stock_movements.organization_id
              AND op.permission_key = 'stock_adjustments_delete'
          ),
          (
            SELECT s.role IN ('admin', 'manager')
            FROM public.staff s
            WHERE s.id = auth.uid()
              AND s.organization_id = product_stock_movements.organization_id
          ),
          false
        )
      )
    )
  );

CREATE OR REPLACE FUNCTION public.delete_stock_adjustment_batch(p_source_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_role text;
  v_allowed boolean;
  v_deleted integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_org := public.auth_organization_id();
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No active organization';
  END IF;

  IF public.is_platform_admin() THEN
    v_allowed := true;
  ELSE
    SELECT s.role
    INTO v_role
    FROM public.staff s
    WHERE s.id = auth.uid()
      AND s.organization_id = v_org
      AND coalesce(s.is_active, true);

    SELECT spo.allowed
    INTO v_allowed
    FROM public.staff_permission_overrides spo
    WHERE spo.organization_id = v_org
      AND spo.staff_id = auth.uid()
      AND spo.permission_key = 'stock_adjustments_delete';

    IF v_allowed IS NULL THEN
      SELECT op.allowed
      INTO v_allowed
      FROM public.organization_permissions op
      WHERE op.organization_id = v_org
        AND op.role_key = v_role
        AND op.permission_key = 'stock_adjustments_delete';
    END IF;

    v_allowed := coalesce(v_allowed, v_role IN ('admin', 'manager'));
  END IF;

  IF NOT coalesce(v_allowed, false) THEN
    RAISE EXCEPTION 'You do not have permission to delete stock adjustments';
  END IF;

  DELETE FROM public.product_stock_movements
  WHERE organization_id = v_org
    AND source_type = 'adjustment'
    AND source_id = p_source_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_stock_adjustment_batch(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_stock_adjustment_batch(uuid) TO authenticated;

COMMENT ON FUNCTION public.delete_stock_adjustment_batch(uuid) IS
  'Deletes one organization-scoped stock adjustment batch after checking stock_adjustments_delete permission.';
