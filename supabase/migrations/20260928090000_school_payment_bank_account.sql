-- Retain the receiving bank GL account on each fee payment so corrections and
-- bank reconciliation can distinguish between multiple school bank accounts.
ALTER TABLE public.school_payments
  ADD COLUMN IF NOT EXISTS bank_gl_account_id uuid
  REFERENCES public.gl_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.school_payments
  ADD COLUMN IF NOT EXISTS bank_payment_source text
  CHECK (bank_payment_source IS NULL OR bank_payment_source IN ('schoolpay', 'bank_slip'));

CREATE INDEX IF NOT EXISTS idx_school_payments_bank_gl_account
  ON public.school_payments (organization_id, bank_gl_account_id)
  WHERE bank_gl_account_id IS NOT NULL;
