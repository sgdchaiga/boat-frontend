-- Global module toggles for all organization types (hotel/retail/sacco/school/etc).

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS enable_reports boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enable_accounting boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enable_inventory boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enable_purchases boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.organizations.enable_reports IS
  'Platform toggle: enables Reports module for this organization.';
COMMENT ON COLUMN public.organizations.enable_accounting IS
  'Platform toggle: enables Accounting module for this organization.';
COMMENT ON COLUMN public.organizations.enable_inventory IS
  'Platform toggle: enables Inventory module for this organization.';
COMMENT ON COLUMN public.organizations.enable_purchases IS
  'Platform toggle: enables Purchases module for this organization.';
