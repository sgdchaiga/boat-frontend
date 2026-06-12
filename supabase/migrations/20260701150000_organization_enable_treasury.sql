ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS enable_treasury boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.organizations.enable_treasury IS
  'When false, hide and block the Treasury module for this tenant.';
