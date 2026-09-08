-- Client control balances used by the accounting-practice reconciliation statement.

CREATE TABLE IF NOT EXISTS public.practice_reconciliation_controls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.practice_clients(id) ON DELETE CASCADE,
  balance_date date NOT NULL,
  label text NOT NULL DEFAULT 'Control balance',
  amount numeric(18,2) NOT NULL,
  recorded_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_practice_reconciliation_controls_client_date
  ON public.practice_reconciliation_controls (client_id, balance_date DESC, created_at DESC);

ALTER TABLE public.practice_reconciliation_controls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS practice_reconciliation_controls_same_org ON public.practice_reconciliation_controls;
CREATE POLICY practice_reconciliation_controls_same_org ON public.practice_reconciliation_controls FOR ALL TO authenticated
USING (public.is_platform_admin() OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
WITH CHECK (public.is_platform_admin() OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.practice_reconciliation_controls TO authenticated;
