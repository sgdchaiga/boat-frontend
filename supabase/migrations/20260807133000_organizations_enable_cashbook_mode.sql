-- General Business Cashbook workspace is optional and controlled by the platform Super Admin.
ALTER TABLE public.organizations
ADD COLUMN IF NOT EXISTS enable_cashbook_mode boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.enable_cashbook_mode IS
  'Platform Super Admin controlled toggle for the General Business Cashbook workspace.';
