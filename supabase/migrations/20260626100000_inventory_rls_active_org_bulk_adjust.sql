-- Inventory RLS: use active organization (user_active_organization), not stale staff.organization_id alone.
-- Bulk stock adjustment RPC for reliable movement inserts.

-- Products
DROP POLICY IF EXISTS "products_select_same_org" ON public.products;
DROP POLICY IF EXISTS "products_write_same_org" ON public.products;

CREATE POLICY "products_select_same_org"
  ON public.products FOR SELECT
  TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      organization_id IS NOT NULL
      AND organization_id = public.auth_organization_id()
    )
  );

CREATE POLICY "products_write_same_org"
  ON public.products FOR ALL
  TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      organization_id IS NOT NULL
      AND organization_id = public.auth_organization_id()
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (
      organization_id IS NOT NULL
      AND organization_id = public.auth_organization_id()
    )
  );

-- Departments
DROP POLICY IF EXISTS "departments_select_same_org" ON public.departments;
DROP POLICY IF EXISTS "departments_write_same_org" ON public.departments;

CREATE POLICY "departments_select_same_org"
  ON public.departments FOR SELECT
  TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      organization_id IS NOT NULL
      AND organization_id = public.auth_organization_id()
    )
  );

CREATE POLICY "departments_write_same_org"
  ON public.departments FOR ALL
  TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      organization_id IS NOT NULL
      AND organization_id = public.auth_organization_id()
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (
      organization_id IS NOT NULL
      AND organization_id = public.auth_organization_id()
    )
  );

-- Product stock movements
DROP POLICY IF EXISTS "psm_select_same_org" ON public.product_stock_movements;
DROP POLICY IF EXISTS "psm_write_same_org" ON public.product_stock_movements;

CREATE POLICY "psm_select_same_org"
  ON public.product_stock_movements FOR SELECT
  TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      organization_id IS NOT NULL
      AND organization_id = public.auth_organization_id()
    )
  );

CREATE POLICY "psm_write_same_org"
  ON public.product_stock_movements FOR ALL
  TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      organization_id IS NOT NULL
      AND organization_id = public.auth_organization_id()
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (
      organization_id IS NOT NULL
      AND organization_id = public.auth_organization_id()
    )
  );

-- Bulk apply stock adjustments (active org from auth_organization_id()).
CREATE OR REPLACE FUNCTION public.apply_stock_adjustments_bulk(
  p_adjustments jsonb,
  p_source_id uuid DEFAULT gen_random_uuid(),
  p_default_reason text DEFAULT 'Bulk stock import'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_row jsonb;
  v_inserted int := 0;
  v_note text;
  v_movement_date timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_org := public.auth_organization_id();
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No active organization — switch organization and try again';
  END IF;

  IF NOT public.user_is_member_of_org(v_org) AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'You are not a member of the active organization';
  END IF;

  IF p_adjustments IS NULL OR jsonb_typeof(p_adjustments) <> 'array' OR jsonb_array_length(p_adjustments) = 0 THEN
    RETURN jsonb_build_object('inserted', 0, 'source_id', p_source_id);
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_adjustments)
  LOOP
    v_note := coalesce(nullif(trim(v_row->>'note'), ''), p_default_reason);
    v_movement_date := coalesce(
      nullif(v_row->>'movement_date', '')::timestamptz,
      now()
    );

    INSERT INTO public.product_stock_movements (
      product_id,
      movement_date,
      source_type,
      source_id,
      quantity_in,
      quantity_out,
      unit_cost,
      note,
      organization_id
    ) VALUES (
      (v_row->>'product_id')::uuid,
      v_movement_date,
      coalesce(nullif(v_row->>'source_type', ''), 'adjustment'),
      coalesce((v_row->>'source_id')::uuid, p_source_id),
      coalesce((v_row->>'quantity_in')::numeric, 0),
      coalesce((v_row->>'quantity_out')::numeric, 0),
      nullif(v_row->>'unit_cost', '')::numeric,
      v_note,
      v_org
    );

    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_inserted, 'source_id', p_source_id);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_stock_adjustments_bulk(jsonb, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_stock_adjustments_bulk(jsonb, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.apply_stock_adjustments_bulk IS
  'Insert adjustment stock movements for the active organization. Each JSON element needs product_id, quantity_in, quantity_out; optional movement_date, note, source_type, source_id.';
