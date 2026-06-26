-- Add quantity fields for asset verification sessions that were created before
-- the quantity-aware migration revision was applied.

ALTER TABLE public.asset_verification_items
  ADD COLUMN IF NOT EXISTS system_quantity numeric(18,4) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS observed_quantity numeric(18,4);

COMMENT ON COLUMN public.asset_verification_items.system_quantity IS
  'Expected/system asset quantity as at the verification date.';

COMMENT ON COLUMN public.asset_verification_items.observed_quantity IS
  'Physical quantity observed during the asset verification count.';

NOTIFY pgrst, 'reload schema';
