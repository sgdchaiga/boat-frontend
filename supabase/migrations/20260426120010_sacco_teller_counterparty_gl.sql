-- Teller cash deposit/withdrawal: user-selected GL account for the non-cash journal line (paired with till/cash).

ALTER TABLE public.sacco_teller_transactions
  ADD COLUMN IF NOT EXISTS counterparty_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sacco_teller_txn_counterparty_gl
  ON public.sacco_teller_transactions (counterparty_gl_account_id)
  WHERE counterparty_gl_account_id IS NOT NULL;

COMMENT ON COLUMN public.sacco_teller_transactions.counterparty_gl_account_id IS
  'GL account for the non-cash side when posting cash deposit/withdrawal journals (e.g. liability/income vs till cash).';
