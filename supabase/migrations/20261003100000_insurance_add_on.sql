-- Insurance is an opt-in operational add-on for licensed BOAT agents/brokers,
-- independent of the organization's primary business type.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS enable_insurance boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.enable_insurance IS
  'Enables BOAT Insurance operational workspace for this organization.';
