-- End-to-end manufacturing traceability and inspection records.
CREATE TABLE IF NOT EXISTS public.product_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  lot_number text NOT NULL,
  supplier_lot_number text,
  manufactured_on date,
  expires_on date,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'on_hold', 'rejected', 'consumed', 'depleted')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, product_id, lot_number)
);

ALTER TABLE public.product_stock_movements ADD COLUMN IF NOT EXISTS lot_id uuid REFERENCES public.product_lots(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_product_lots_org_product ON public.product_lots (organization_id, product_id, status);
CREATE INDEX IF NOT EXISTS idx_product_stock_movements_lot ON public.product_stock_movements (organization_id, lot_id, movement_date DESC);

CREATE TABLE IF NOT EXISTS public.manufacturing_quality_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  inspection_type text NOT NULL CHECK (inspection_type IN ('receiving', 'in_process', 'finished_goods')),
  checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS public.manufacturing_quality_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.manufacturing_quality_templates(id) ON DELETE SET NULL,
  inspection_type text NOT NULL CHECK (inspection_type IN ('receiving', 'in_process', 'finished_goods')),
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  lot_id uuid REFERENCES public.product_lots(id) ON DELETE SET NULL,
  work_order_id uuid REFERENCES public.manufacturing_work_orders(id) ON DELETE SET NULL,
  job_card_id uuid REFERENCES public.manufacturing_job_cards(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'passed', 'failed', 'on_hold')),
  sample_qty numeric(18,3),
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  inspected_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  inspected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quality_inspections_org_status ON public.manufacturing_quality_inspections (organization_id, inspection_type, status, created_at DESC);

ALTER TABLE public.product_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manufacturing_quality_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manufacturing_quality_inspections ENABLE ROW LEVEL SECURITY;
DO $pol$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['product_lots', 'manufacturing_quality_templates', 'manufacturing_quality_inspections'] LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_platform_admin() OR (public.auth_staff_org_id() IS NOT NULL AND organization_id = public.auth_staff_org_id())) WITH CHECK (public.is_platform_admin() OR (public.auth_staff_org_id() IS NOT NULL AND organization_id = public.auth_staff_org_id()))', tbl || '_tenant_all', tbl);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', tbl);
  END LOOP;
END $pol$;

CREATE OR REPLACE FUNCTION public.apply_quality_inspection_lot_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.lot_id IS NOT NULL THEN
    UPDATE public.product_lots SET status = CASE NEW.status WHEN 'passed' THEN 'available' WHEN 'failed' THEN 'rejected' WHEN 'on_hold' THEN 'on_hold' ELSE status END, updated_at = now() WHERE id = NEW.lot_id AND organization_id = NEW.organization_id;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_apply_quality_inspection_lot_status
AFTER INSERT OR UPDATE OF status, lot_id ON public.manufacturing_quality_inspections
FOR EACH ROW EXECUTE FUNCTION public.apply_quality_inspection_lot_status();
