-- Hotel / mixed orgs: retail_invoices.guest_id FK to property customer profile.
-- retail_customers remains for retail/restaurant invoice flows.
-- FK target: first existing among hotel_customers, customers, guests (schema evolution).

DO $$
DECLARE
  ref_table text;
BEGIN
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
