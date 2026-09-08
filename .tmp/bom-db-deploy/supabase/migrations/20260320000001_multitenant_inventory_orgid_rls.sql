-- Multi-tenant isolation for Inventory:
-- Add `organization_id` to products/departments/product_stock_movements, backfill from
-- POS stock movements (source_type='sale' -> kitchen_orders.created_by -> staff.organization_id),
-- set it automatically for new rows using triggers, and enforce org-scoped RLS.

-- 1) Columns
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.product_stock_movements ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

-- 2) Backfill stock movements for sales
-- product_stock_movements.source_type='sale' should point to kitchen_orders via source_id.
UPDATE public.product_stock_movements psm
SET organization_id = s.organization_id
FROM public.kitchen_orders ko
JOIN public.staff s ON s.id = ko.created_by
WHERE psm.source_type = 'sale'
  AND psm.source_id = ko.id
  AND psm.organization_id IS NULL
  AND s.organization_id IS NOT NULL;

-- Backfill products from movements
UPDATE public.products pr
SET organization_id = sub.organization_id
FROM (
  SELECT
    psm.product_id,
    (ARRAY_AGG(psm.organization_id ORDER BY psm.movement_date DESC NULLS LAST))[1] AS organization_id
  FROM public.product_stock_movements psm
  WHERE psm.organization_id IS NOT NULL
  GROUP BY psm.product_id
) sub
WHERE pr.id = sub.product_id
  AND pr.organization_id IS NULL;

-- Backfill departments from products
UPDATE public.departments d
SET organization_id = sub.organization_id
FROM (
  SELECT
    pr.department_id AS department_id,
    (ARRAY_AGG(pr.organization_id))[1] AS organization_id
  FROM public.products pr
  WHERE pr.department_id IS NOT NULL
    AND pr.organization_id IS NOT NULL
  GROUP BY pr.department_id
) sub
WHERE d.id = sub.department_id
  AND d.organization_id IS NULL;

-- 3) Triggers: set org_id on insert (default from auth staff row)
CREATE OR REPLACE FUNCTION public.set_org_id_from_auth_staff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    SELECT s.organization_id INTO NEW.organization_id
    FROM public.staff s
    WHERE s.id = auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_org_products ON public.products;
CREATE TRIGGER trg_set_org_products
BEFORE INSERT ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_departments ON public.departments;
CREATE TRIGGER trg_set_org_departments
BEFORE INSERT ON public.departments
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_product_stock_movements ON public.product_stock_movements;
CREATE TRIGGER trg_set_org_product_stock_movements
BEFORE INSERT ON public.product_stock_movements
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

-- 4) RLS policies
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_stock_movements ENABLE ROW LEVEL SECURITY;

-- Products
DROP POLICY IF EXISTS "products_select_same_org" ON public.products;
DROP POLICY IF EXISTS "products_write_same_org" ON public.products;

CREATE POLICY "products_select_same_org"
  ON public.products FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

CREATE POLICY "products_write_same_org"
  ON public.products FOR ALL
  TO authenticated
  USING (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

-- Departments
DROP POLICY IF EXISTS "departments_select_same_org" ON public.departments;
DROP POLICY IF EXISTS "departments_write_same_org" ON public.departments;

CREATE POLICY "departments_select_same_org"
  ON public.departments FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

CREATE POLICY "departments_write_same_org"
  ON public.departments FOR ALL
  TO authenticated
  USING (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

-- Product stock movements
DROP POLICY IF EXISTS "psm_select_same_org" ON public.product_stock_movements;
DROP POLICY IF EXISTS "psm_write_same_org" ON public.product_stock_movements;

CREATE POLICY "psm_select_same_org"
  ON public.product_stock_movements FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

CREATE POLICY "psm_write_same_org"
  ON public.product_stock_movements FOR ALL
  TO authenticated
  USING (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

