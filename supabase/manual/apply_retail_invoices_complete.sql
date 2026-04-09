-- =============================================================================
-- BOAT: Retail / sales invoices — apply in Supabase SQL Editor (one run)
-- =============================================================================
-- Prerequisites (normal BOAT installs already have these):
--   - public.organizations, public.staff, public.products
--   - property customer table: public.hotel_customers, public.customers, or public.guests (any one)
-- This script creates:
--   - set_org_id_from_auth_staff() if missing (used by triggers)
--   - retail_invoices, retail_invoice_lines, retail_customers
--   - customer_id + guest_id columns and RLS policies
-- Idempotent: safe to re-run; uses IF NOT EXISTS / CREATE OR REPLACE where possible.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_org_id_from_auth_staff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

-- --- 20260326000000_retail_invoices.sql -------------------------------------------------

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

-- --- 20260327000000_retail_customers.sql ------------------------------------------------

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

-- --- 20260329000000_retail_invoices_guest_id.sql --------------------------------------
-- FK to hotel_customers / customers / guests (whichever exists; see migration file).

DO $$
DECLARE
  ref_table text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'retail_invoices' AND column_name = 'property_customer_id'
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'retail_invoices' AND column_name = 'guest_id'
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'hotel_customers' AND c.relkind = 'r'
  ) THEN
    ref_table := 'hotel_customers';
  ELSIF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'customers' AND c.relkind = 'r'
  ) THEN
    ref_table := 'customers';
  ELSIF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'guests' AND c.relkind = 'r'
  ) THEN
    ref_table := 'guests';
  ELSE
    RAISE EXCEPTION 'Expected public.hotel_customers, public.customers, or public.guests for retail_invoices.guest_id FK';
  END IF;

  EXECUTE format(
    'ALTER TABLE public.retail_invoices ADD COLUMN guest_id uuid REFERENCES public.%I(id) ON DELETE SET NULL',
    ref_table
  );
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'retail_invoices' AND column_name = 'guest_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_retail_invoices_guest ON public.retail_invoices(guest_id)';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'retail_invoices' AND column_name = 'guest_id'
  ) THEN
    EXECUTE $com$
      COMMENT ON COLUMN public.retail_invoices.guest_id IS
        'Hotel/mixed: links invoice to property customer profile; use customer_id for retail_customers.'
    $com$;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'retail_invoices_customer_or_guest_chk'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'retail_invoices' AND column_name = 'guest_id'
  ) THEN
    ALTER TABLE public.retail_invoices
      ADD CONSTRAINT retail_invoices_customer_or_guest_chk
      CHECK (customer_id IS NULL OR guest_id IS NULL);
  END IF;
END $$;

-- --- 20260401000000_rename_guest_id_to_property_customer_id.sql -----------------------
-- Idempotent (safe if guest_id already renamed).

ALTER TABLE public.retail_invoices
  DROP CONSTRAINT IF EXISTS retail_invoices_customer_or_guest_chk;

DROP INDEX IF EXISTS public.idx_retail_invoices_guest;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reservations' AND column_name = 'guest_id'
  ) THEN
    ALTER TABLE public.reservations RENAME COLUMN guest_id TO property_customer_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stays' AND column_name = 'guest_id'
  ) THEN
    ALTER TABLE public.stays RENAME COLUMN guest_id TO property_customer_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'retail_invoices' AND column_name = 'guest_id'
  ) THEN
    ALTER TABLE public.retail_invoices RENAME COLUMN guest_id TO property_customer_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'retail_invoices' AND column_name = 'property_customer_id'
  ) THEN
    EXECUTE $idx$
      CREATE INDEX IF NOT EXISTS idx_retail_invoices_property_customer
      ON public.retail_invoices (property_customer_id)
    $idx$;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'retail_invoices' AND column_name = 'property_customer_id'
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'retail_invoices_customer_or_property_customer_chk'
  ) THEN
    ALTER TABLE public.retail_invoices
      ADD CONSTRAINT retail_invoices_customer_or_property_customer_chk
      CHECK (customer_id IS NULL OR property_customer_id IS NULL);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reservations' AND column_name = 'property_customer_id'
  ) THEN
    EXECUTE $c$
      COMMENT ON COLUMN public.reservations.property_customer_id IS
        'Property customer (hotel): references public.customers(id).'
    $c$;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stays' AND column_name = 'property_customer_id'
  ) THEN
    EXECUTE $c$
      COMMENT ON COLUMN public.stays.property_customer_id IS
        'Property customer (hotel): references public.customers(id).'
    $c$;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'retail_invoices' AND column_name = 'property_customer_id'
  ) THEN
    EXECUTE $c$
      COMMENT ON COLUMN public.retail_invoices.property_customer_id IS
        'Hotel/mixed: links invoice to public.customers.id. retail_invoices.customer_id references retail_customers.'
    $c$;
  END IF;
END $$;

-- --- 20260402000000_rename_customers_to_hotel_customers.sql ----------------------------

ALTER TABLE IF EXISTS public.customers RENAME TO hotel_customers;

COMMENT ON TABLE public.hotel_customers IS
  'Hotel/property customer profiles (stays, reservations, invoicing). Not retail_customers.';

COMMENT ON COLUMN public.reservations.property_customer_id IS
  'References public.hotel_customers(id).';

COMMENT ON COLUMN public.stays.property_customer_id IS
  'References public.hotel_customers(id).';

COMMENT ON COLUMN public.retail_invoices.property_customer_id IS
  'Hotel/mixed: links invoice to public.hotel_customers.id. retail_invoices.customer_id references retail_customers.';

-- Notify PostgREST to reload schema (helps if tables existed but API still 404’d)
NOTIFY pgrst, 'reload schema';
