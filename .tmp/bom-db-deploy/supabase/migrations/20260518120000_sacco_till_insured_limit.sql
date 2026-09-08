-- SACCO teller: per-till insured cash limit for manager oversight alerts.

ALTER TABLE public.journal_gl_settings
  ADD COLUMN IF NOT EXISTS sacco_till_insured_limit_ugx numeric
  CHECK (sacco_till_insured_limit_ugx IS NULL OR sacco_till_insured_limit_ugx >= 0);

COMMENT ON COLUMN public.journal_gl_settings.sacco_till_insured_limit_ugx IS
  'Maximum cash allowed per open till before uninsured exposure alert (UGX). NULL = not configured.';
