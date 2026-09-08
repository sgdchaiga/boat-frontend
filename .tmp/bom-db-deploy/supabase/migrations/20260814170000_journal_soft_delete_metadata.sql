-- Complete the journal soft-delete metadata expected by hotel checkout and
-- atomic folio-edit functions. Existing journal controls already use is_deleted.
ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

CREATE INDEX IF NOT EXISTS idx_journal_entries_org_deleted_at
  ON public.journal_entries (organization_id, deleted_at DESC)
  WHERE is_deleted = true;
