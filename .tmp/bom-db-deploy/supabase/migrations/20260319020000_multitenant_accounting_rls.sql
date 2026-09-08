-- Multi-tenant isolation for accounting:
-- - Add `organization_id` to GL + journal tables
-- - Backfill based on existing `created_by` staff rows
-- - Replace permissive RLS policies that currently allow cross-organization reads

-- 1) Add tenant columns
ALTER TABLE public.gl_accounts
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

-- 2) Backfill journal_entries.organization_id from created_by -> staff.organization_id
UPDATE public.journal_entries je
SET organization_id = s.organization_id
FROM public.staff s
WHERE je.created_by = s.id
  AND je.organization_id IS NULL
  AND s.organization_id IS NOT NULL;

-- 3) Backfill gl_accounts.organization_id using journal usage
-- Assumption: a given gl_account is used by one organization (via journal_entries.created_by).
UPDATE public.gl_accounts ga
SET organization_id = sub.organization_id
FROM (
  SELECT jel.gl_account_id AS gl_account_id,
         -- if an account was used by multiple orgs, pick the most recent org assignment source
         (ARRAY_AGG(je.organization_id ORDER BY je.created_at DESC NULLS LAST))[1] AS organization_id
  FROM public.journal_entry_lines jel
  JOIN public.journal_entries je ON je.id = jel.journal_entry_id
  WHERE je.organization_id IS NOT NULL
  GROUP BY jel.gl_account_id
) sub
WHERE ga.id = sub.gl_account_id
  AND ga.organization_id IS NULL;

-- 4) Triggers: ensure future inserts automatically get organization_id
CREATE OR REPLACE FUNCTION public.set_journal_entry_org_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Prefer created_by -> staff.organization_id, but fall back to the current
  -- authenticated user's staff row.
  IF NEW.created_by IS NOT NULL THEN
    SELECT organization_id
    INTO NEW.organization_id
    FROM public.staff
    WHERE id = NEW.created_by;
  END IF;

  IF NEW.organization_id IS NULL THEN
    SELECT organization_id
    INTO NEW.organization_id
    FROM public.staff
    WHERE id = auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_gl_account_org_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Current app user is a staff member, so use auth.uid() -> staff.id -> staff.organization_id
  SELECT organization_id
  INTO NEW.organization_id
  FROM public.staff
  WHERE id = auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_journal_entry_org_id ON public.journal_entries;
CREATE TRIGGER trg_set_journal_entry_org_id
BEFORE INSERT ON public.journal_entries
FOR EACH ROW
EXECUTE FUNCTION public.set_journal_entry_org_id();

DROP TRIGGER IF EXISTS trg_set_gl_account_org_id ON public.gl_accounts;
CREATE TRIGGER trg_set_gl_account_org_id
BEFORE INSERT ON public.gl_accounts
FOR EACH ROW
EXECUTE FUNCTION public.set_gl_account_org_id();

-- 5) RLS: replace permissive "USING (true)" policies
ALTER TABLE public.gl_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entry_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can manage journal_entries" ON public.journal_entries;
DROP POLICY IF EXISTS "Authenticated can manage journal_entry_lines" ON public.journal_entry_lines;

-- Journal entries: allow access only to staff within the same organization
DROP POLICY IF EXISTS "org_journal_entries_select" ON public.journal_entries;
DROP POLICY IF EXISTS "org_journal_entries_write" ON public.journal_entries;
CREATE POLICY "org_journal_entries_select"
  ON public.journal_entries
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.staff s
      WHERE s.id = auth.uid()
        AND s.organization_id = journal_entries.organization_id
    )
  );

CREATE POLICY "org_journal_entries_write"
  ON public.journal_entries
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.staff s
      WHERE s.id = auth.uid()
        AND s.organization_id = journal_entries.organization_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.staff s
      WHERE s.id = auth.uid()
        AND s.organization_id = journal_entries.organization_id
    )
  );

DROP POLICY IF EXISTS "org_journal_entry_lines_select" ON public.journal_entry_lines;
DROP POLICY IF EXISTS "org_journal_entry_lines_write" ON public.journal_entry_lines;
-- Journal lines: tenant is inherited from the parent journal_entry
CREATE POLICY "org_journal_entry_lines_select"
  ON public.journal_entry_lines
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.journal_entries je
      WHERE je.id = journal_entry_lines.journal_entry_id
        AND EXISTS (
          SELECT 1
          FROM public.staff s
          WHERE s.id = auth.uid()
            AND s.organization_id = je.organization_id
        )
    )
  );

CREATE POLICY "org_journal_entry_lines_write"
  ON public.journal_entry_lines
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.journal_entries je
      WHERE je.id = journal_entry_lines.journal_entry_id
        AND EXISTS (
          SELECT 1
          FROM public.staff s
          WHERE s.id = auth.uid()
            AND s.organization_id = je.organization_id
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.journal_entries je
      WHERE je.id = journal_entry_lines.journal_entry_id
        AND EXISTS (
          SELECT 1
          FROM public.staff s
          WHERE s.id = auth.uid()
            AND s.organization_id = je.organization_id
        )
    )
  );

-- GL accounts: allow only within the same organization
DROP POLICY IF EXISTS "org_gl_accounts_select" ON public.gl_accounts;
DROP POLICY IF EXISTS "org_gl_accounts_write" ON public.gl_accounts;
CREATE POLICY "org_gl_accounts_select"
  ON public.gl_accounts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.staff s
      WHERE s.id = auth.uid()
        AND s.organization_id = gl_accounts.organization_id
    )
  );

CREATE POLICY "org_gl_accounts_write"
  ON public.gl_accounts
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.staff s
      WHERE s.id = auth.uid()
        AND s.organization_id = gl_accounts.organization_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.staff s
      WHERE s.id = auth.uid()
        AND s.organization_id = gl_accounts.organization_id
    )
  );

