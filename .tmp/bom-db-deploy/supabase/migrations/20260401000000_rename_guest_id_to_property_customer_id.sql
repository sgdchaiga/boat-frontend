-- Align FK column names: guest_id -> property_customer_id
-- Idempotent: skips tables/columns already migrated (property_customer_id present, guest_id gone).

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

NOTIFY pgrst, 'reload schema';
