-- VAT defaults for automatic posting and expense entry (per organization)

ALTER TABLE public.journal_gl_settings
  ADD COLUMN IF NOT EXISTS vat_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.journal_gl_settings
  ADD COLUMN IF NOT EXISTS default_vat_percent numeric(7, 4);

COMMENT ON COLUMN public.journal_gl_settings.vat_gl_account_id IS
  'Default VAT / input tax liability GL for expense lines when VAT GL is not chosen per line.';

COMMENT ON COLUMN public.journal_gl_settings.default_vat_percent IS
  'Default VAT rate % for new expense entries (e.g. 18). Nullable = use app default.';

ALTER TABLE public.journal_gl_settings
  DROP CONSTRAINT IF EXISTS journal_gl_settings_default_vat_percent_range;

ALTER TABLE public.journal_gl_settings
  ADD CONSTRAINT journal_gl_settings_default_vat_percent_range
  CHECK (default_vat_percent IS NULL OR (default_vat_percent >= 0 AND default_vat_percent <= 100));
