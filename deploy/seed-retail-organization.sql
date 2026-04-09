-- Run after migrations. Sets the default tenant to retail (POS / shop workflows).
UPDATE public.organizations
SET
  business_type = 'retail',
  name = COALESCE(NULLIF(trim(name), ''), 'Retail shop'),
  enable_front_desk = false,
  enable_billing = true,
  enable_pos = true,
  enable_inventory = true,
  enable_purchases = true,
  enable_accounting = true,
  enable_reports = true,
  enable_admin = true
WHERE slug = 'default';
