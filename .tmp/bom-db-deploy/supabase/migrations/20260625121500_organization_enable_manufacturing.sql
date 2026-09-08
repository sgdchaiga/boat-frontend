-- Platform superadmin: turn Manufacturing (BOM, work orders, costing) on or off per organization.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS enable_manufacturing boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.organizations.enable_manufacturing IS
  'When false, manufacturing module routes and navigation are hidden. Controlled from the platform Organizations console.';
