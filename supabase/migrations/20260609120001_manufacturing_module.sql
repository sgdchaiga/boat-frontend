-- Manufacturing module: BOMs, work orders, production entries, and costing.

CREATE TABLE IF NOT EXISTS public.manufacturing_boms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_name text NOT NULL,
  version text NOT NULL DEFAULT 'v1',
  materials_count integer NOT NULL DEFAULT 0 CHECK (materials_count >= 0),
  output_qty numeric(18,3) NOT NULL DEFAULT 1 CHECK (output_qty > 0),
  output_unit text NOT NULL DEFAULT 'unit',
  status text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Active', 'Archived')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.manufacturing_work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bom_id uuid REFERENCES public.manufacturing_boms(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  planned_qty numeric(18,3) NOT NULL DEFAULT 0 CHECK (planned_qty >= 0),
  completed_qty numeric(18,3) NOT NULL DEFAULT 0 CHECK (completed_qty >= 0),
  start_date date,
  due_date date,
  status text NOT NULL DEFAULT 'Planned' CHECK (status IN ('Planned', 'In Progress', 'Completed', 'Cancelled')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.manufacturing_production_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  work_order_id uuid REFERENCES public.manufacturing_work_orders(id) ON DELETE SET NULL,
  product_name text,
  produced_qty numeric(18,3) NOT NULL DEFAULT 0 CHECK (produced_qty >= 0),
  scrap_qty numeric(18,3) NOT NULL DEFAULT 0 CHECK (scrap_qty >= 0),
  posted_at timestamptz NOT NULL DEFAULT now(),
  posted_by_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.manufacturing_production_entries.posted_by_staff_id IS
  'Staff member responsible for the production entry (shown on daily production reports).';

CREATE TABLE IF NOT EXISTS public.manufacturing_costing_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period text NOT NULL,
  product_name text NOT NULL,
  material_cost numeric(18,2) NOT NULL DEFAULT 0 CHECK (material_cost >= 0),
  labor_cost numeric(18,2) NOT NULL DEFAULT 0 CHECK (labor_cost >= 0),
  overhead_cost numeric(18,2) NOT NULL DEFAULT 0 CHECK (overhead_cost >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_manufacturing_boms_org ON public.manufacturing_boms (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manufacturing_work_orders_org ON public.manufacturing_work_orders (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manufacturing_production_entries_org ON public.manufacturing_production_entries (organization_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_manufacturing_costing_entries_org_period ON public.manufacturing_costing_entries (organization_id, period);

CREATE OR REPLACE FUNCTION public.touch_manufacturing_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_manufacturing_boms_touch ON public.manufacturing_boms;
CREATE TRIGGER trg_manufacturing_boms_touch BEFORE UPDATE ON public.manufacturing_boms
FOR EACH ROW EXECUTE FUNCTION public.touch_manufacturing_updated_at();

DROP TRIGGER IF EXISTS trg_manufacturing_work_orders_touch ON public.manufacturing_work_orders;
CREATE TRIGGER trg_manufacturing_work_orders_touch BEFORE UPDATE ON public.manufacturing_work_orders
FOR EACH ROW EXECUTE FUNCTION public.touch_manufacturing_updated_at();

DROP TRIGGER IF EXISTS trg_manufacturing_costing_entries_touch ON public.manufacturing_costing_entries;
CREATE TRIGGER trg_manufacturing_costing_entries_touch BEFORE UPDATE ON public.manufacturing_costing_entries
FOR EACH ROW EXECUTE FUNCTION public.touch_manufacturing_updated_at();

DROP TRIGGER IF EXISTS trg_set_org_manufacturing_boms ON public.manufacturing_boms;
CREATE TRIGGER trg_set_org_manufacturing_boms BEFORE INSERT ON public.manufacturing_boms
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_manufacturing_work_orders ON public.manufacturing_work_orders;
CREATE TRIGGER trg_set_org_manufacturing_work_orders BEFORE INSERT ON public.manufacturing_work_orders
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_manufacturing_production_entries ON public.manufacturing_production_entries;
CREATE TRIGGER trg_set_org_manufacturing_production_entries BEFORE INSERT ON public.manufacturing_production_entries
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_manufacturing_costing_entries ON public.manufacturing_costing_entries;
CREATE TRIGGER trg_set_org_manufacturing_costing_entries BEFORE INSERT ON public.manufacturing_costing_entries
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

ALTER TABLE public.manufacturing_boms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manufacturing_work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manufacturing_production_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manufacturing_costing_entries ENABLE ROW LEVEL SECURITY;

DO $pol$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'manufacturing_boms',
    'manufacturing_work_orders',
    'manufacturing_production_entries',
    'manufacturing_costing_entries'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_tenant_all', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
       USING (public.is_platform_admin() OR (public.auth_staff_org_id() IS NOT NULL AND organization_id = public.auth_staff_org_id()))
       WITH CHECK (public.is_platform_admin() OR (public.auth_staff_org_id() IS NOT NULL AND organization_id = public.auth_staff_org_id()))',
      tbl || '_tenant_all',
      tbl
    );
  END LOOP;
END $pol$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.manufacturing_boms TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.manufacturing_work_orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.manufacturing_production_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.manufacturing_costing_entries TO authenticated;
