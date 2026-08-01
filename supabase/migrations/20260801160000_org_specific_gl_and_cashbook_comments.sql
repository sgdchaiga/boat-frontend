-- Account codes are unique inside an organization, not across the whole platform.
ALTER TABLE public.gl_accounts DROP CONSTRAINT IF EXISTS gl_accounts_account_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS gl_accounts_org_code_unique
  ON public.gl_accounts (organization_id, account_code)
  WHERE organization_id IS NOT NULL;

ALTER TABLE public.general_business_cashbook_entries
  ADD COLUMN IF NOT EXISTS comments text;
