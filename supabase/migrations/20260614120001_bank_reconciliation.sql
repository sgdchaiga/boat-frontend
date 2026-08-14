-- Two-way bank reconciliation between imported statement lines and posted GL bank lines.

CREATE TABLE IF NOT EXISTS public.bank_statement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bank_gl_account_id uuid NOT NULL REFERENCES public.gl_accounts(id) ON DELETE CASCADE,
  statement_date date NOT NULL,
  description text NOT NULL DEFAULT '',
  reference text,
  amount numeric(18, 2) NOT NULL CHECK (amount <> 0),
  imported_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_org_account_date
  ON public.bank_statement_lines (organization_id, bank_gl_account_id, statement_date DESC);

CREATE TABLE IF NOT EXISTS public.bank_reconciliation_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bank_gl_account_id uuid NOT NULL REFERENCES public.gl_accounts(id) ON DELETE CASCADE,
  match_method text NOT NULL CHECK (match_method IN ('auto', 'manual')),
  notes text,
  matched_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  matched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_reconciliation_matches_org_account
  ON public.bank_reconciliation_matches (organization_id, bank_gl_account_id, matched_at DESC);

CREATE TABLE IF NOT EXISTS public.bank_reconciliation_match_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.bank_reconciliation_matches(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('statement', 'ledger')),
  statement_line_id uuid REFERENCES public.bank_statement_lines(id) ON DELETE CASCADE,
  journal_entry_line_id uuid REFERENCES public.journal_entry_lines(id) ON DELETE CASCADE,
  amount numeric(18, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (side = 'statement' AND statement_line_id IS NOT NULL AND journal_entry_line_id IS NULL)
    OR
    (side = 'ledger' AND journal_entry_line_id IS NOT NULL AND statement_line_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_reconciliation_statement_item
  ON public.bank_reconciliation_match_items (statement_line_id)
  WHERE statement_line_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_reconciliation_ledger_item
  ON public.bank_reconciliation_match_items (journal_entry_line_id)
  WHERE journal_entry_line_id IS NOT NULL;

ALTER TABLE public.bank_statement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_reconciliation_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_reconciliation_match_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bank_statement_lines_same_org ON public.bank_statement_lines;
CREATE POLICY bank_statement_lines_same_org ON public.bank_statement_lines FOR ALL TO authenticated
  USING (public.is_platform_admin() OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
  WITH CHECK (public.is_platform_admin() OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

DROP POLICY IF EXISTS bank_reconciliation_matches_same_org ON public.bank_reconciliation_matches;
CREATE POLICY bank_reconciliation_matches_same_org ON public.bank_reconciliation_matches FOR ALL TO authenticated
  USING (public.is_platform_admin() OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
  WITH CHECK (public.is_platform_admin() OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

DROP POLICY IF EXISTS bank_reconciliation_match_items_same_org ON public.bank_reconciliation_match_items;
CREATE POLICY bank_reconciliation_match_items_same_org ON public.bank_reconciliation_match_items FOR ALL TO authenticated
  USING (
    public.is_platform_admin() OR EXISTS (
      SELECT 1 FROM public.bank_reconciliation_matches m
      WHERE m.id = bank_reconciliation_match_items.match_id
        AND m.organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
    )
  )
  WITH CHECK (
    public.is_platform_admin() OR EXISTS (
      SELECT 1 FROM public.bank_reconciliation_matches m
      WHERE m.id = bank_reconciliation_match_items.match_id
        AND m.organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_statement_lines TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_reconciliation_matches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_reconciliation_match_items TO authenticated;

COMMENT ON COLUMN public.bank_statement_lines.amount IS 'Signed bank amount: deposits positive, withdrawals negative.';
