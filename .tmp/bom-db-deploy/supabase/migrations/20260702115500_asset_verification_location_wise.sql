-- Allow the same asset type/code to be verified in multiple locations within
-- one asset verification campaign.

ALTER TABLE public.asset_verification_items
  DROP CONSTRAINT IF EXISTS asset_verification_items_verification_id_asset_code_key;

CREATE INDEX IF NOT EXISTS idx_asset_verification_items_code_location
  ON public.asset_verification_items (verification_id, asset_code, expected_location, observed_location);

NOTIFY pgrst, 'reload schema';
