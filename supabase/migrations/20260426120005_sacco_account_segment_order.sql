-- Order of segments when building savings account numbers (permutation of branch, account_type, serial).
ALTER TABLE public.sacco_account_number_settings
  ADD COLUMN IF NOT EXISTS segment_order text NOT NULL DEFAULT 'branch,account_type,serial';

COMMENT ON COLUMN public.sacco_account_number_settings.segment_order IS
  'Comma-separated: branch, account_type, serial — defines left-to-right order in the account number.';
