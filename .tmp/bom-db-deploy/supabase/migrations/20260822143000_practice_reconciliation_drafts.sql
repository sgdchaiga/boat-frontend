CREATE TABLE IF NOT EXISTS public.practice_reconciliation_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.practice_clients(id) ON DELETE CASCADE,
  saved_by uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  cashbook_source text NOT NULL,
  statement_source text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  selected_cashbook_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  selected_statement_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, saved_by)
);

ALTER TABLE public.practice_reconciliation_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS practice_reconciliation_drafts_same_org ON public.practice_reconciliation_drafts;
CREATE POLICY practice_reconciliation_drafts_same_org ON public.practice_reconciliation_drafts
FOR ALL TO authenticated
USING (
  organization_id = (SELECT staff.organization_id FROM public.staff WHERE staff.id = auth.uid())
  AND saved_by = auth.uid()
)
WITH CHECK (
  organization_id = (SELECT staff.organization_id FROM public.staff WHERE staff.id = auth.uid())
  AND saved_by = auth.uid()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.practice_reconciliation_drafts TO authenticated;

COMMENT ON TABLE public.practice_reconciliation_drafts IS 'Per-user saved progress for source-scoped client reconciliations.';
