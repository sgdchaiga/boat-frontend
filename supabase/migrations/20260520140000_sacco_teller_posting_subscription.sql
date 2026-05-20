-- SACCO teller: allow subscription as a posting purpose (fee collections).

ALTER TABLE public.sacco_teller_transactions
  DROP CONSTRAINT IF EXISTS sacco_teller_transactions_posting_purpose_check;

ALTER TABLE public.sacco_teller_transactions
  ADD CONSTRAINT sacco_teller_transactions_posting_purpose_check
  CHECK (
    posting_purpose IS NULL
    OR posting_purpose IN (
      'savings',
      'membership_fee',
      'subscription',
      'shares',
      'loan_repayment',
      'fee_or_penalty',
      'other'
    )
  );
