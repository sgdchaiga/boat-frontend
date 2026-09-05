-- Planning quantity only; actual scrap continues to be recorded on production entries.
ALTER TABLE public.manufacturing_boms
  ADD COLUMN IF NOT EXISTS expected_scrap_qty numeric(18,3) NOT NULL DEFAULT 0
  CHECK (expected_scrap_qty >= 0);

COMMENT ON COLUMN public.manufacturing_boms.expected_scrap_qty IS
  'Expected scrap in the organization scrap stock unit per output_qty. Suggested in new production entries; actual scrap can be overridden.';
