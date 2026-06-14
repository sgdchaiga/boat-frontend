-- Auditable and reversible client reconciliation runs.

CREATE TABLE IF NOT EXISTS public.practice_reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.practice_clients(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  method text NOT NULL CHECK (method IN ('auto', 'manual')),
  side_mode text NOT NULL DEFAULT 'both' CHECK (side_mode IN ('cashbook', 'statement', 'both')),
  notes text,
  reconciled_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  reconciled_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.practice_reconciliation_lines
  ADD COLUMN IF NOT EXISTS reconciliation_run_id uuid REFERENCES public.practice_reconciliation_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_practice_reconciliation_runs_client_period
  ON public.practice_reconciliation_runs (client_id, period_end DESC, reconciled_at DESC);

CREATE INDEX IF NOT EXISTS idx_practice_reconciliation_lines_run
  ON public.practice_reconciliation_lines (reconciliation_run_id);

ALTER TABLE public.practice_reconciliation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS practice_reconciliation_runs_same_org ON public.practice_reconciliation_runs;
CREATE POLICY practice_reconciliation_runs_same_org ON public.practice_reconciliation_runs FOR ALL TO authenticated
USING (public.is_platform_admin() OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
WITH CHECK (public.is_platform_admin() OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.practice_reconciliation_runs TO authenticated;
