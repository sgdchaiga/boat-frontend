-- Mobile money gateway selector and provider-specific attempt metadata.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS retail_mobile_money_gateway text NOT NULL DEFAULT 'flutterwave'
  CHECK (retail_mobile_money_gateway IN ('flutterwave', 'dpo'));

COMMENT ON COLUMN public.organizations.retail_mobile_money_gateway IS
  'Retail POS STK/mobile money gateway provider. Defaults to flutterwave; set dpo per tenant when DPO credentials are configured.';

ALTER TABLE public.mobile_money_attempts
  ADD COLUMN IF NOT EXISTS gateway_provider text NOT NULL DEFAULT 'flutterwave'
    CHECK (gateway_provider IN ('flutterwave', 'dpo')),
  ADD COLUMN IF NOT EXISTS dpo_transaction_token text,
  ADD COLUMN IF NOT EXISTS gateway_transaction_ref text;

CREATE INDEX IF NOT EXISTS idx_mobile_money_attempts_gateway_provider
  ON public.mobile_money_attempts (gateway_provider, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mobile_money_attempts_dpo_token
  ON public.mobile_money_attempts (dpo_transaction_token)
  WHERE dpo_transaction_token IS NOT NULL;
