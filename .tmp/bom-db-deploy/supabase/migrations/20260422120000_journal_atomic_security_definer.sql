-- create_journal_entry_atomic used SECURITY INVOKER so RLS hid existing rows during:
--   (1) idempotency SELECT (reference_type + reference_id)
--   (2) unique_violation handler SELECT
-- That caused duplicate-key errors when a journal row existed but the caller could not SELECT it,
-- and INSERT failures when created_by pointed at staff in another org (organization_id mismatch).
-- Run as definer so journal posting / backfill can see rows and enforce uniqueness reliably.

ALTER FUNCTION public.create_journal_entry_atomic(date, text, text, uuid, uuid, jsonb) SECURITY DEFINER;

COMMENT ON FUNCTION public.create_journal_entry_atomic(date, text, text, uuid, uuid, jsonb) IS
  'Atomic journal header + lines; idempotent on (reference_type, reference_id). SECURITY DEFINER so RLS does not block idempotency checks.';
