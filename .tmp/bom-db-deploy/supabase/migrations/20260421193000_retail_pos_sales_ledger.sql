-- Retail POS sales ledger: offline-safe sale header, lines, and split payments.

CREATE TABLE IF NOT EXISTS public.retail_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sale_number text,
  sale_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL,
  customer_id uuid REFERENCES public.retail_customers(id) ON DELETE SET NULL,
  customer_name text,
  customer_phone text,
  sale_channel text NOT NULL DEFAULT 'pos_retail' CHECK (sale_channel IN ('pos_retail')),
  sale_status text NOT NULL DEFAULT 'posted' CHECK (sale_status IN ('draft', 'queued_offline', 'posted', 'void', 'refunded')),
  total_amount numeric(15,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  amount_paid numeric(15,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  amount_due numeric(15,2) NOT NULL DEFAULT 0 CHECK (amount_due >= 0),
  change_amount numeric(15,2) NOT NULL DEFAULT 0 CHECK (change_amount >= 0),
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'partial', 'completed', 'overpaid', 'refunded')),
  vat_enabled boolean NOT NULL DEFAULT false,
  vat_rate numeric(7,4),
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.retail_sale_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.retail_sales(id) ON DELETE CASCADE,
  line_no int NOT NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  description text NOT NULL DEFAULT '',
  quantity numeric(15,4) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric(15,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  line_total numeric(15,2) NOT NULL DEFAULT 0 CHECK (line_total >= 0),
  unit_cost numeric(15,2),
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  track_inventory boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.retail_sale_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.retail_sales(id) ON DELETE CASCADE,
  payment_method text NOT NULL,
  amount numeric(15,2) NOT NULL CHECK (amount >= 0),
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'completed', 'failed', 'refunded')),
  reference text,
  paid_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_retail_sales_org_sale_at ON public.retail_sales(organization_id, sale_at DESC);
CREATE INDEX IF NOT EXISTS idx_retail_sale_lines_sale ON public.retail_sale_lines(sale_id, line_no);
CREATE INDEX IF NOT EXISTS idx_retail_sale_payments_sale ON public.retail_sale_payments(sale_id, paid_at DESC);

CREATE OR REPLACE FUNCTION public.touch_retail_sales_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_retail_sales_touch_updated ON public.retail_sales;
CREATE TRIGGER trg_retail_sales_touch_updated
BEFORE UPDATE ON public.retail_sales
FOR EACH ROW
EXECUTE FUNCTION public.touch_retail_sales_updated_at();

DROP TRIGGER IF EXISTS trg_set_org_retail_sales ON public.retail_sales;
CREATE TRIGGER trg_set_org_retail_sales
BEFORE INSERT ON public.retail_sales
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

ALTER TABLE public.retail_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retail_sale_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retail_sale_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "retail_sales_select_same_org" ON public.retail_sales;
DROP POLICY IF EXISTS "retail_sales_write_same_org" ON public.retail_sales;
DROP POLICY IF EXISTS "retail_sale_lines_select_same_org" ON public.retail_sale_lines;
DROP POLICY IF EXISTS "retail_sale_lines_write_same_org" ON public.retail_sale_lines;
DROP POLICY IF EXISTS "retail_sale_payments_select_same_org" ON public.retail_sale_payments;
DROP POLICY IF EXISTS "retail_sale_payments_write_same_org" ON public.retail_sale_payments;

CREATE POLICY "retail_sales_select_same_org"
  ON public.retail_sales FOR SELECT TO authenticated
  USING (
    organization_id IS NOT NULL
    AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
  );

CREATE POLICY "retail_sales_write_same_org"
  ON public.retail_sales FOR ALL TO authenticated
  USING (
    organization_id IS NOT NULL
    AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
  );

CREATE POLICY "retail_sale_lines_select_same_org"
  ON public.retail_sale_lines FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.retail_sales rs
      WHERE rs.id = retail_sale_lines.sale_id
        AND rs.organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
    )
  );

CREATE POLICY "retail_sale_lines_write_same_org"
  ON public.retail_sale_lines FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.retail_sales rs
      WHERE rs.id = retail_sale_lines.sale_id
        AND rs.organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.retail_sales rs
      WHERE rs.id = retail_sale_lines.sale_id
        AND rs.organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
    )
  );

CREATE POLICY "retail_sale_payments_select_same_org"
  ON public.retail_sale_payments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.retail_sales rs
      WHERE rs.id = retail_sale_payments.sale_id
        AND rs.organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
    )
  );

CREATE POLICY "retail_sale_payments_write_same_org"
  ON public.retail_sale_payments FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.retail_sales rs
      WHERE rs.id = retail_sale_payments.sale_id
        AND rs.organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.retail_sales rs
      WHERE rs.id = retail_sale_payments.sale_id
        AND rs.organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
    )
  );

COMMENT ON TABLE public.retail_sales IS 'Retail POS sales header with idempotency key for offline replay safety.';
COMMENT ON TABLE public.retail_sale_lines IS 'Retail POS line items linked to retail_sales.';
COMMENT ON TABLE public.retail_sale_payments IS 'Split tenders per retail sale (cash, card, mobile money, etc.).';
