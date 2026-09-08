-- BOAT Assistant is optional and may only be enabled per organization by a platform Super Admin.
ALTER TABLE public.organizations
ADD COLUMN IF NOT EXISTS enable_assistant boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.enable_assistant IS
  'Platform Super Admin controlled toggle for the optional BOAT Assistant panel.';
