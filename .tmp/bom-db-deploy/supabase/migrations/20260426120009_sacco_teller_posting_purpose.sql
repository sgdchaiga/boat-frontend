-- Teller: business purpose (membership fee, savings, etc.) and optional savings account target.

ALTER TABLE public.sacco_teller_transactions
  ADD COLUMN IF NOT EXISTS sacco_member_savings_account_id uuid REFERENCES public.sacco_member_savings_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.sacco_teller_transactions
  ADD COLUMN IF NOT EXISTS posting_purpose text;

ALTER TABLE public.sacco_teller_transactions
  DROP CONSTRAINT IF EXISTS sacco_teller_transactions_posting_purpose_check;

ALTER TABLE public.sacco_teller_transactions
  ADD CONSTRAINT sacco_teller_transactions_posting_purpose_check
  CHECK (
    posting_purpose IS NULL
    OR posting_purpose IN (
      'savings',
      'membership_fee',
      'shares',
      'loan_repayment',
      'fee_or_penalty',
      'other'
    )
  );

CREATE INDEX IF NOT EXISTS idx_sacco_teller_txn_savings_acct
  ON public.sacco_teller_transactions (sacco_member_savings_account_id)
  WHERE sacco_member_savings_account_id IS NOT NULL;

COMMENT ON COLUMN public.sacco_teller_transactions.posting_purpose IS 'Business purpose: savings deposit/withdrawal, membership fee, shares, etc.';
COMMENT ON COLUMN public.sacco_teller_transactions.sacco_member_savings_account_id IS 'Target savings product account when posting_purpose is savings.';
