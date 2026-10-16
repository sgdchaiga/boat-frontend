-- Supplier-payment imports keep the user-entered reference separate from
-- identifiers, batch information and the vote/subvote supplied in the file.
ALTER TABLE public.vendor_payments
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS import_batch_id text,
  ADD COLUMN IF NOT EXISTS import_fingerprint text,
  ADD COLUMN IF NOT EXISTS import_vote text,
  ADD COLUMN IF NOT EXISTS import_subvote text;

CREATE INDEX IF NOT EXISTS vendor_payments_org_import_batch_idx
  ON public.vendor_payments (organization_id, import_batch_id)
  WHERE import_batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS vendor_payments_org_bank_name_idx
  ON public.vendor_payments (organization_id, bank_name)
  WHERE bank_name IS NOT NULL;

-- Preserve information held in the legacy overloaded reference field.
UPDATE public.vendor_payments
SET
  bank_name = COALESCE(bank_name, NULLIF(btrim((regexp_match(reference, '(?i)(?:^|/)\s*Bank:\s*([^/\[]+)'))[1]), '')),
  import_batch_id = COALESCE(import_batch_id, NULLIF(btrim((regexp_match(reference, '(?i)\[BATCH:([^\]]+)\]'))[1]), '')),
  import_fingerprint = COALESCE(import_fingerprint, NULLIF(btrim((regexp_match(reference, '(?i)\[IMP:([^\]]+)\]'))[1]), '')),
  import_vote = COALESCE(import_vote, NULLIF(btrim((regexp_match(reference, '(?i)(?:^|/)\s*Vote:\s*([^/\[]+)'))[1]), '')),
  import_subvote = COALESCE(import_subvote, NULLIF(btrim((regexp_match(reference, '(?i)(?:^|/)\s*Subvote:\s*([^/\[]+)'))[1]), ''))
WHERE reference IS NOT NULL;

-- The preceding historical migration may have run before its escaped patterns were
-- corrected. Re-run the recovery here so already-deployed databases are repaired.
UPDATE public.vendor_payments
SET cheque_number = NULLIF(trim((regexp_match(reference, '(?i)\mCHQ\s*(?:NO\.?\s*)?([^/\[]+)'))[1]), '')
WHERE cheque_number IS NULL AND reference ~* '\mCHQ\s*(?:NO\.?\s*)?[^/\[]+';

UPDATE public.vendor_payments
SET payment_voucher = NULLIF(trim((regexp_match(reference, '(?i)\mPV\s*(?:NO\.?\s*)?([^/\[]+)'))[1]), '')
WHERE payment_voucher IS NULL AND reference ~* '\mPV\s*(?:NO\.?\s*)?[^/\[]+';

-- Older spreadsheet imports manufactured the reference from payment metadata.
-- When that happens, use the supplied subvote as the readable narration.
UPDATE public.vendor_payments
SET reference = COALESCE(NULLIF(import_subvote, ''), NULLIF(import_vote, ''), 'Supplier payment')
WHERE reference ~* '^\s*(?:CHQ|PV|Vote:|Subvote:)'
  AND (import_batch_id IS NOT NULL OR import_fingerprint IS NOT NULL);
