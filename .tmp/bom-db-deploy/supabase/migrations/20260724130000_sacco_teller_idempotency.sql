-- Prevent double-clicks and network retries from creating duplicate teller transactions.
-- Rollback: DROP INDEX IF EXISTS ux_sacco_teller_txn_idempotency;
--           ALTER TABLE public.sacco_teller_transactions DROP COLUMN IF EXISTS idempotency_key;

ALTER TABLE public.sacco_teller_transactions
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_sacco_teller_txn_idempotency
  ON public.sacco_teller_transactions (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.sacco_teller_transactions.idempotency_key IS
  'Stable client request key. A retry returns the original transaction instead of posting twice.';
