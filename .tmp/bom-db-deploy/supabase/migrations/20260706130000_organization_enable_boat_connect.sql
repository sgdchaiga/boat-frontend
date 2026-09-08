ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS enable_boat_connect boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.organizations.enable_boat_connect IS
  'Platform toggle for BOAT Connect universal data integrations, synchronization, warehouse, and reporting layer.';
