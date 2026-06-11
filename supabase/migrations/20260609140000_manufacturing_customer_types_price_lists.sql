CREATE TABLE IF NOT EXISTS public.manufacturing_customer_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

ALTER TABLE public.retail_customers
  ADD COLUMN IF NOT EXISTS manufacturing_customer_type_id uuid
  REFERENCES public.manufacturing_customer_types(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.manufacturing_price_list (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  customer_type_id uuid NOT NULL REFERENCES public.manufacturing_customer_types(id) ON DELETE CASCADE,
  min_qty numeric(15,3) NOT NULL DEFAULT 1 CHECK (min_qty > 0),
  price numeric(15,2) NOT NULL CHECK (price >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, product_id, customer_type_id, min_qty)
);

CREATE INDEX IF NOT EXISTS idx_manufacturing_price_list_lookup
  ON public.manufacturing_price_list (organization_id, customer_type_id, product_id, min_qty DESC);

INSERT INTO public.manufacturing_customer_types (organization_id, name)
SELECT o.id, v.name
FROM public.organizations o
CROSS JOIN (VALUES ('Retail'), ('Dealer'), ('Distributor')) AS v(name)
WHERE o.business_type = 'manufacturing'
ON CONFLICT (organization_id, name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.seed_manufacturing_customer_types()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.business_type = 'manufacturing' THEN
    INSERT INTO public.manufacturing_customer_types (organization_id, name)
    VALUES (NEW.id, 'Retail'), (NEW.id, 'Dealer'), (NEW.id, 'Distributor')
    ON CONFLICT (organization_id, name) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_manufacturing_customer_types ON public.organizations;
CREATE TRIGGER trg_seed_manufacturing_customer_types
AFTER INSERT OR UPDATE OF business_type ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.seed_manufacturing_customer_types();

ALTER TABLE public.manufacturing_customer_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manufacturing_price_list ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "manufacturing_customer_types_same_org" ON public.manufacturing_customer_types;
CREATE POLICY "manufacturing_customer_types_same_org"
  ON public.manufacturing_customer_types FOR ALL TO authenticated
  USING (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
  WITH CHECK (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

DROP POLICY IF EXISTS "manufacturing_price_list_same_org" ON public.manufacturing_price_list;
CREATE POLICY "manufacturing_price_list_same_org"
  ON public.manufacturing_price_list FOR ALL TO authenticated
  USING (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
  WITH CHECK (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));
