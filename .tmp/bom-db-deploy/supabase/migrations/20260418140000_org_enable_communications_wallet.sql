-- Platform super user: toggle Communications hub and Wallet per organization.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS enable_communications boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enable_wallet boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.organizations.enable_communications IS 'When false, hide Communications (SMS/WhatsApp hub) for this tenant.';
COMMENT ON COLUMN public.organizations.enable_wallet IS 'When false, hide Wallet module for this tenant.';
