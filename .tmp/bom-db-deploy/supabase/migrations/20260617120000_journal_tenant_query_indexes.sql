-- Performance indexes for tenant-scoped journal queries.
-- Targets common filters/sorts used by JournalEntriesPage:
--   organization_id, reference_type, entry_date

-- journal_entries: tenant + source filter + date ordering
CREATE INDEX IF NOT EXISTS idx_journal_entries_org_ref_date
  ON public.journal_entries (organization_id, reference_type, entry_date DESC);

-- journal_entries: tenant + date ordering (broad list views)
CREATE INDEX IF NOT EXISTS idx_journal_entries_org_date
  ON public.journal_entries (organization_id, entry_date DESC);

-- gl_accounts: tenant-scoped account fetches
CREATE INDEX IF NOT EXISTS idx_gl_accounts_org
  ON public.gl_accounts (organization_id);

-- gl_accounts: faster active account dropdowns by org + code ordering
CREATE INDEX IF NOT EXISTS idx_gl_accounts_org_active_code
  ON public.gl_accounts (organization_id, account_code)
  WHERE is_active = true;

-- Optional tenant index for journal_entry_lines if organization_id exists.
-- (Some deployments keep tenant isolation via parent journal_entry only.)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'journal_entry_lines'
      AND column_name = 'organization_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_org ON public.journal_entry_lines (organization_id)';
  END IF;
END;
$$;
