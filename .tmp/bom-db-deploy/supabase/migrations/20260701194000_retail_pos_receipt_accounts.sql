ALTER TABLE public.retail_sale_payments
  ADD COLUMN IF NOT EXISTS receipt_gl_account_id uuid
    REFERENCES public.gl_accounts(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.retail_sale_payments.receipt_gl_account_id IS
  'Bank, wallet, or other receipt GL account selected for this POS tender.';

NOTIFY pgrst, 'reload schema';
