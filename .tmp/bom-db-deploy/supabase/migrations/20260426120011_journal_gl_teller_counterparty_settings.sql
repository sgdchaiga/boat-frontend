-- SACCO teller: org chooses per-transaction counterparty GL vs a single default from journal settings.

ALTER TABLE public.journal_gl_settings
  ADD COLUMN IF NOT EXISTS teller_allow_per_transaction_counterparty_gl boolean NOT NULL DEFAULT true;

ALTER TABLE public.journal_gl_settings
  ADD COLUMN IF NOT EXISTS teller_default_counterparty_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.journal_gl_settings.teller_allow_per_transaction_counterparty_gl IS
  'When true, teller staff picks the counterparty GL on each cash deposit/withdrawal; when false, use teller_default_counterparty_gl_account_id.';

COMMENT ON COLUMN public.journal_gl_settings.teller_default_counterparty_gl_account_id IS
  'Default GL for the non-cash journal line on teller cash flows when teller_allow_per_transaction_counterparty_gl is false.';
