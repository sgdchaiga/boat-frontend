-- Organization-level retail STK push toggle.
-- OFF: Retail POS keeps legacy manual mobile money behavior.
-- ON: Retail POS attempts Flutterwave STK push + verification flow.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS retail_stk_push_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.retail_stk_push_enabled IS
  'Retail POS mobile money mode. false = manual entry/pending, true = Flutterwave STK push automation.';
