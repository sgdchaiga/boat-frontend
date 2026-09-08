-- Optional depreciation defaults per asset category (applied when choosing the category on an asset).

ALTER TABLE public.fixed_asset_categories
  ADD COLUMN IF NOT EXISTS default_useful_life_months int
    CHECK (default_useful_life_months IS NULL OR default_useful_life_months > 0);

ALTER TABLE public.fixed_asset_categories
  ADD COLUMN IF NOT EXISTS default_reducing_balance_rate_percent numeric(10, 4)
    CHECK (default_reducing_balance_rate_percent IS NULL OR default_reducing_balance_rate_percent > 0);

COMMENT ON COLUMN public.fixed_asset_categories.default_useful_life_months IS
  'Default useful life (months) for straight-line when an asset is assigned to this category.';
COMMENT ON COLUMN public.fixed_asset_categories.default_reducing_balance_rate_percent IS
  'Default annual reducing-balance rate (%) when an asset uses reducing balance in this category.';
