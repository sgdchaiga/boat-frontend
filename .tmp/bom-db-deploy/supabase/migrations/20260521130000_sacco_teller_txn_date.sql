-- Business calendar date for teller transactions (day filters, GL/cashbook entry_date).
-- Distinct from created_at (audit timestamp).

ALTER TABLE public.sacco_teller_transactions
  ADD COLUMN IF NOT EXISTS txn_date date;

UPDATE public.sacco_teller_transactions
SET txn_date = (timezone('Africa/Kampala', created_at))::date
WHERE txn_date IS NULL;

ALTER TABLE public.sacco_teller_transactions
  ALTER COLUMN txn_date SET DEFAULT (timezone('Africa/Kampala', now()))::date;

ALTER TABLE public.sacco_teller_transactions
  ALTER COLUMN txn_date SET NOT NULL;

COMMENT ON COLUMN public.sacco_teller_transactions.txn_date IS
  'Business posting date (Kampala calendar). Used for teller day views and journal/cashbook entry_date.';

CREATE INDEX IF NOT EXISTS idx_sacco_teller_txn_org_txn_date
  ON public.sacco_teller_transactions (organization_id, txn_date DESC);
