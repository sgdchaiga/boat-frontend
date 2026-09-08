-- Sales module: manual retail invoices with multiple line items (preview / print / PDF in app)

CREATE TABLE IF NOT EXISTS public.retail_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invoice_number text NOT NULL,
  customer_name text NOT NULL DEFAULT '',
  customer_email text,
  customer_address text,
  issue_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'void')),
  notes text,
  subtotal numeric(15,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  tax_amount numeric(15,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total numeric(15,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  UNIQUE (organization_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS public.retail_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.retail_invoices(id) ON DELETE CASCADE,
  line_no int NOT NULL,
  description text NOT NULL DEFAULT '',
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  quantity numeric(15,4) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric(15,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  line_total numeric(15,2) NOT NULL DEFAULT 0 CHECK (line_total >= 0)
);

CREATE INDEX IF NOT EXISTS idx_retail_invoices_org_issue ON public.retail_invoices(organization_id, issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_retail_invoice_lines_invoice ON public.retail_invoice_lines(invoice_id);

DROP TRIGGER IF EXISTS trg_set_org_retail_invoices ON public.retail_invoices;
CREATE TRIGGER trg_set_org_retail_invoices
BEFORE INSERT ON public.retail_invoices
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

CREATE OR REPLACE FUNCTION public.touch_retail_invoice_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_retail_invoices_touch_updated ON public.retail_invoices;
CREATE TRIGGER trg_retail_invoices_touch_updated
BEFORE UPDATE ON public.retail_invoices
FOR EACH ROW
EXECUTE FUNCTION public.touch_retail_invoice_updated_at();

ALTER TABLE public.retail_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retail_invoice_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "retail_invoices_select_same_org" ON public.retail_invoices;
DROP POLICY IF EXISTS "retail_invoices_write_same_org" ON public.retail_invoices;
DROP POLICY IF EXISTS "retail_invoice_lines_select_same_org" ON public.retail_invoice_lines;
DROP POLICY IF EXISTS "retail_invoice_lines_write_same_org" ON public.retail_invoice_lines;

CREATE POLICY "retail_invoices_select_same_org"
  ON public.retail_invoices FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

CREATE POLICY "retail_invoices_write_same_org"
  ON public.retail_invoices FOR ALL
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

CREATE POLICY "retail_invoice_lines_select_same_org"
  ON public.retail_invoice_lines FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.retail_invoices ri
      WHERE ri.id = retail_invoice_lines.invoice_id
        AND ri.organization_id IS NOT NULL
        AND ri.organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
    )
  );

CREATE POLICY "retail_invoice_lines_write_same_org"
  ON public.retail_invoice_lines FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.retail_invoices ri
      WHERE ri.id = retail_invoice_lines.invoice_id
        AND ri.organization_id IS NOT NULL
        AND ri.organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.retail_invoices ri
      WHERE ri.id = retail_invoice_lines.invoice_id
        AND ri.organization_id IS NOT NULL
        AND ri.organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
    )
  );

COMMENT ON TABLE public.retail_invoices IS 'Manual sales invoices (multi-line); separate from POS payment rows.';
COMMENT ON TABLE public.retail_invoice_lines IS 'Line items for retail_invoices.';
