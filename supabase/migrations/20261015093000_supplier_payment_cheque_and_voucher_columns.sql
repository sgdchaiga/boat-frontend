-- Structured payment identifiers support bank-statement and cashbook matching.
ALTER TABLE public.vendor_payments
  ADD COLUMN IF NOT EXISTS cheque_number text,
  ADD COLUMN IF NOT EXISTS payment_voucher text;

-- Recover identifiers retained in historical supplier-payment references.
UPDATE public.vendor_payments
SET cheque_number = NULLIF(trim((regexp_match(reference, '(?i)\mCHQ\s*(?:NO\.?\s*)?([^/\[]+)'))[1]), '')
WHERE cheque_number IS NULL AND reference ~* '\mCHQ\s*(?:NO\.?\s*)?[^/\[]+';

UPDATE public.vendor_payments
SET payment_voucher = NULLIF(trim((regexp_match(reference, '(?i)\mPV\s*(?:NO\.?\s*)?([^/\[]+)'))[1]), '')
WHERE payment_voucher IS NULL AND reference ~* '\mPV\s*(?:NO\.?\s*)?[^/\[]+';

CREATE INDEX IF NOT EXISTS vendor_payments_org_cheque_number_idx
  ON public.vendor_payments(organization_id, cheque_number)
  WHERE cheque_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS vendor_payments_org_payment_voucher_idx
  ON public.vendor_payments(organization_id, payment_voucher)
  WHERE payment_voucher IS NOT NULL;
