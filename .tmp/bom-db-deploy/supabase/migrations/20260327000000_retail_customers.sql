-- Retail / sales customers for invoice billing (separate from hotel guests)

CREATE TABLE IF NOT EXISTS public.retail_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text,
  phone text,
  address text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_retail_customers_org_name ON public.retail_customers(organization_id, lower(name));

DROP TRIGGER IF EXISTS trg_set_org_retail_customers ON public.retail_customers;
CREATE TRIGGER trg_set_org_retail_customers
BEFORE INSERT ON public.retail_customers
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

CREATE OR REPLACE FUNCTION public.touch_retail_customers_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_retail_customers_touch_updated ON public.retail_customers;
CREATE TRIGGER trg_retail_customers_touch_updated
BEFORE UPDATE ON public.retail_customers
FOR EACH ROW
EXECUTE FUNCTION public.touch_retail_customers_updated_at();

ALTER TABLE public.retail_invoices
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.retail_customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_retail_invoices_customer ON public.retail_invoices(customer_id);

ALTER TABLE public.retail_customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "retail_customers_select_same_org" ON public.retail_customers;
DROP POLICY IF EXISTS "retail_customers_write_same_org" ON public.retail_customers;

CREATE POLICY "retail_customers_select_same_org"
  ON public.retail_customers FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

CREATE POLICY "retail_customers_write_same_org"
  ON public.retail_customers FOR ALL
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

COMMENT ON TABLE public.retail_customers IS 'Sales/retail customers for invoicing (not hotel guests).';
