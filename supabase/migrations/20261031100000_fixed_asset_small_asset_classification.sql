-- Keep low-value items in the operational asset register without treating them as PPE.
ALTER TABLE public.fixed_assets
  ADD COLUMN IF NOT EXISTS asset_classification text;

ALTER TABLE public.fixed_assets
  DROP CONSTRAINT IF EXISTS fixed_assets_asset_classification_check;

ALTER TABLE public.fixed_assets
  ADD CONSTRAINT fixed_assets_asset_classification_check
  CHECK (asset_classification IS NULL OR asset_classification IN ('fixed_asset', 'small_asset'));

UPDATE public.fixed_assets
SET asset_classification = CASE WHEN cost < 1000000 THEN 'small_asset' ELSE 'fixed_asset' END
WHERE asset_classification IS NULL;

ALTER TABLE public.fixed_asset_org_settings
  ADD COLUMN IF NOT EXISTS capitalization_threshold numeric(15,2) NOT NULL DEFAULT 1000000
  CHECK (capitalization_threshold >= 0);
