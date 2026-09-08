-- Expand bank reconciliation into a unified cash, float, bank, mobile-money, and wallet module.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS enable_reconciliation boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.organizations.enable_reconciliation IS
  'Platform-superuser toggle for the unified cash and float reconciliation module.';

ALTER TABLE public.bank_statement_lines
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'bank',
  ADD COLUMN IF NOT EXISTS source_label text;

ALTER TABLE public.bank_statement_lines
  DROP CONSTRAINT IF EXISTS bank_statement_lines_source_type_check;

ALTER TABLE public.bank_statement_lines
  ADD CONSTRAINT bank_statement_lines_source_type_check
  CHECK (source_type IN ('bank', 'cash_count', 'till_float', 'vault', 'mobile_money', 'wallet', 'other'));

CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_org_source_date
  ON public.bank_statement_lines (organization_id, source_type, statement_date DESC);

COMMENT ON TABLE public.bank_statement_lines IS
  'External/control-side reconciliation lines: statements, cash counts, floats, vault, mobile money, and wallet balances.';
