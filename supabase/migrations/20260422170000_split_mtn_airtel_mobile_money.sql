-- Split generic mobile_money into MTN Mobile Money and Airtel Money (payments + journal GL settings).

-- Incoming payments: migrate values, then tighten CHECK.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_payment_method_check;

UPDATE public.payments
SET payment_method = 'mtn_mobile_money'
WHERE payment_method = 'mobile_money';

ALTER TABLE public.payments
  ADD CONSTRAINT payments_payment_method_check
  CHECK (payment_method IN (
    'cash', 'card', 'bank_transfer',
    'mtn_mobile_money', 'airtel_money'
  ));

COMMENT ON CONSTRAINT payments_payment_method_check ON public.payments IS
  'POS/debtor payment channel; mobile split into MTN vs Airtel.';

-- Journal defaults: two asset slots (replaces single pos_mobile_money_gl_account_id).
ALTER TABLE public.journal_gl_settings
  ADD COLUMN IF NOT EXISTS pos_mtn_mobile_money_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pos_airtel_money_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL;

UPDATE public.journal_gl_settings
SET pos_mtn_mobile_money_gl_account_id = pos_mobile_money_gl_account_id
WHERE pos_mtn_mobile_money_gl_account_id IS NULL
  AND pos_mobile_money_gl_account_id IS NOT NULL;

ALTER TABLE public.journal_gl_settings
  DROP COLUMN IF EXISTS pos_mobile_money_gl_account_id;

COMMENT ON COLUMN public.journal_gl_settings.pos_mtn_mobile_money_gl_account_id IS
  'POS receipt GL — MTN Mobile Money.';
COMMENT ON COLUMN public.journal_gl_settings.pos_airtel_money_gl_account_id IS
  'POS receipt GL — Airtel Money.';
