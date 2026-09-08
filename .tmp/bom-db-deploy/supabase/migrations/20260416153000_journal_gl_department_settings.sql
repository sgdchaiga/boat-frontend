CREATE TABLE IF NOT EXISTS public.journal_gl_department_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  sales_gl_account_id uuid,
  purchases_gl_account_id uuid,
  stock_gl_account_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, department_id)
);

CREATE INDEX IF NOT EXISTS idx_journal_gl_department_settings_org
  ON public.journal_gl_department_settings(organization_id);
