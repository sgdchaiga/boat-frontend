CREATE TABLE IF NOT EXISTS public.business_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('planned', 'active', 'completed', 'on_hold', 'cancelled')),
  start_date date,
  end_date date,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.business_projects(id) ON DELETE SET NULL;
ALTER TABLE public.retail_invoices ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.business_projects(id) ON DELETE SET NULL;
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.business_projects(id) ON DELETE SET NULL;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.business_projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_business_projects_org_status ON public.business_projects(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_expenses_project ON public.expenses(project_id);
CREATE INDEX IF NOT EXISTS idx_retail_invoices_project ON public.retail_invoices(project_id);
CREATE INDEX IF NOT EXISTS idx_bills_project ON public.bills(project_id);
CREATE INDEX IF NOT EXISTS idx_payments_project ON public.payments(project_id);

ALTER TABLE public.business_projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS business_projects_same_org ON public.business_projects;
CREATE POLICY business_projects_same_org ON public.business_projects
FOR ALL TO authenticated
USING (public.user_is_member_of_org(organization_id))
WITH CHECK (public.user_is_member_of_org(organization_id));

COMMENT ON TABLE public.business_projects IS
  'Operational projects for General Business organizations; income and expenditure can be tagged and reported per project.';
