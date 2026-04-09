-- Period budgets with optional GL account links per line (per-organization RLS).

CREATE TABLE IF NOT EXISTS public.budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  period_label text,
  start_date date,
  end_date date,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_budgets_org ON public.budgets (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.budget_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id uuid NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
  gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  line_label text NOT NULL,
  amount numeric(18, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  sort_order int NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_budget_lines_budget ON public.budget_lines (budget_id, sort_order);

DROP TRIGGER IF EXISTS trg_set_org_budgets ON public.budgets;
CREATE TRIGGER trg_set_org_budgets
  BEFORE INSERT ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

CREATE OR REPLACE FUNCTION public.touch_budgets_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_budgets_touch ON public.budgets;
CREATE TRIGGER trg_budgets_touch
  BEFORE UPDATE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.touch_budgets_updated_at();

ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS budgets_select_same_org ON public.budgets;
DROP POLICY IF EXISTS budgets_write_same_org ON public.budgets;
CREATE POLICY budgets_select_same_org ON public.budgets FOR SELECT TO authenticated
  USING (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );
CREATE POLICY budgets_write_same_org ON public.budgets FOR ALL TO authenticated
  USING (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS budget_lines_select_same_org ON public.budget_lines;
DROP POLICY IF EXISTS budget_lines_write_same_org ON public.budget_lines;
CREATE POLICY budget_lines_select_same_org ON public.budget_lines FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.budgets b
      WHERE b.id = budget_lines.budget_id
        AND b.organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
    )
  );
CREATE POLICY budget_lines_write_same_org ON public.budget_lines FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.budgets b
      WHERE b.id = budget_lines.budget_id
        AND b.organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.budgets b
      WHERE b.id = budget_lines.budget_id
        AND b.organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.budgets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.budget_lines TO authenticated;

COMMENT ON TABLE public.budgets IS 'Organization budget periods (e.g. fiscal year).';
COMMENT ON TABLE public.budget_lines IS 'Budget amounts per line; optional link to chart of accounts.';
