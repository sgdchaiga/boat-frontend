-- Payroll cost classifications are deliberately business-neutral.  A department
-- tells us where an employee works; this tells us which salary expense account
-- receives their payroll cost.
CREATE TABLE IF NOT EXISTS public.payroll_cost_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  salary_expense_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_cost_classifications_org_code_unique UNIQUE (organization_id, code)
);

ALTER TABLE public.payroll_employee_profiles
  ADD COLUMN IF NOT EXISTS payroll_cost_classification_id uuid
  REFERENCES public.payroll_cost_classifications(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payroll_cost_classifications_org
  ON public.payroll_cost_classifications (organization_id);
CREATE INDEX IF NOT EXISTS idx_payroll_employee_profiles_cost_classification
  ON public.payroll_employee_profiles (payroll_cost_classification_id);

DROP TRIGGER IF EXISTS trg_set_org_payroll_cost_classifications ON public.payroll_cost_classifications;
CREATE TRIGGER trg_set_org_payroll_cost_classifications BEFORE INSERT ON public.payroll_cost_classifications
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

ALTER TABLE public.payroll_cost_classifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payroll_cost_classifications_select_same_org ON public.payroll_cost_classifications;
DROP POLICY IF EXISTS payroll_cost_classifications_write_same_org ON public.payroll_cost_classifications;
CREATE POLICY payroll_cost_classifications_select_same_org ON public.payroll_cost_classifications FOR SELECT TO authenticated USING (
  organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
);
CREATE POLICY payroll_cost_classifications_write_same_org ON public.payroll_cost_classifications FOR ALL TO authenticated USING (
  organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
) WITH CHECK (
  organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_cost_classifications TO authenticated;

COMMENT ON TABLE public.payroll_cost_classifications IS
  'Business-neutral payroll cost classification and its salary expense GL mapping. Department remains a reporting dimension.';
