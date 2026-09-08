-- Ensure expenses.vendor_id exists (some projects created expenses without this column)
-- Run via Supabase SQL Editor or `supabase db push` if the error references schema cache for vendor_id.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'expenses'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'expenses' AND column_name = 'vendor_id'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'vendors'
    ) THEN
      ALTER TABLE public.expenses
        ADD COLUMN vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL;
    ELSE
      ALTER TABLE public.expenses ADD COLUMN vendor_id uuid;
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_expenses_vendor_id ON public.expenses(vendor_id) WHERE vendor_id IS NOT NULL;
