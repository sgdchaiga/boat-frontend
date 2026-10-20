-- Repeatable petty-cash imports use a stable row fingerprint and an upload batch.
ALTER TABLE public.school_petty_cash_vouchers
  ADD COLUMN IF NOT EXISTS import_batch_id text,
  ADD COLUMN IF NOT EXISTS import_fingerprint text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_school_petty_cash_vouchers_import_fingerprint
  ON public.school_petty_cash_vouchers (organization_id, import_fingerprint)
  WHERE import_fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_school_petty_cash_vouchers_import_batch
  ON public.school_petty_cash_vouchers (organization_id, import_batch_id, created_at DESC)
  WHERE import_batch_id IS NOT NULL;

COMMENT ON COLUMN public.school_petty_cash_vouchers.import_batch_id IS 'Bulk-upload batch identifier for audit and correction.';
COMMENT ON COLUMN public.school_petty_cash_vouchers.import_fingerprint IS 'Stable row key that makes re-uploading a petty-cash file idempotent.';
