CREATE TABLE IF NOT EXISTS public.cost_allocation_centres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text,
  name text NOT NULL,
  centre_type text NOT NULL DEFAULT 'production'
    CHECK (centre_type IN ('production', 'administration', 'sales', 'support', 'other')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cost_allocation_driver_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period text NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  cost_centre_id uuid NOT NULL REFERENCES public.cost_allocation_centres(id) ON DELETE CASCADE,
  basis text NOT NULL CHECK (basis IN ('floor_area', 'headcount', 'machine_hours', 'labour_hours', 'asset_value', 'revenue', 'custom_percentage')),
  driver_value numeric(18,4) NOT NULL DEFAULT 0 CHECK (driver_value >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, period, cost_centre_id, basis)
);

CREATE TABLE IF NOT EXISTS public.cost_allocation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  expense_gl_account_id uuid NOT NULL REFERENCES public.gl_accounts(id) ON DELETE RESTRICT,
  debit_gl_account_id uuid NOT NULL REFERENCES public.gl_accounts(id) ON DELETE RESTRICT,
  target_cost_centre_id uuid REFERENCES public.cost_allocation_centres(id) ON DELETE CASCADE,
  basis text NOT NULL CHECK (basis IN ('floor_area', 'headcount', 'machine_hours', 'labour_hours', 'asset_value', 'revenue', 'custom_percentage')),
  custom_percentage numeric(9,4) CHECK (custom_percentage IS NULL OR (custom_percentage >= 0 AND custom_percentage <= 100)),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cost_allocation_rule_centres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES public.cost_allocation_rules(id) ON DELETE CASCADE,
  cost_centre_id uuid NOT NULL REFERENCES public.cost_allocation_centres(id) ON DELETE CASCADE,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, rule_id, cost_centre_id)
);

CREATE TABLE IF NOT EXISTS public.cost_allocation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period text NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'reversed')),
  total_amount numeric(18,2) NOT NULL DEFAULT 0,
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  reversal_journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  approved_at timestamptz,
  reversed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cost_allocation_production_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.cost_allocation_runs(id) ON DELETE SET NULL,
  period text NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  production_entry_id uuid REFERENCES public.manufacturing_production_entries(id) ON DELETE SET NULL,
  basis text NOT NULL DEFAULT 'produced_qty',
  basis_value numeric(18,4) NOT NULL DEFAULT 0,
  allocated_amount numeric(18,2) NOT NULL DEFAULT 0,
  journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cost_allocation_centres_org ON public.cost_allocation_centres (organization_id, is_active, name);
CREATE INDEX IF NOT EXISTS idx_cost_allocation_driver_values_org_period ON public.cost_allocation_driver_values (organization_id, period, basis);
CREATE INDEX IF NOT EXISTS idx_cost_allocation_rules_org ON public.cost_allocation_rules (organization_id, is_active);
CREATE INDEX IF NOT EXISTS idx_cost_allocation_rule_centres_org_rule ON public.cost_allocation_rule_centres (organization_id, rule_id, is_enabled);
CREATE INDEX IF NOT EXISTS idx_cost_allocation_runs_org_period ON public.cost_allocation_runs (organization_id, period, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_allocation_batches_org_period ON public.cost_allocation_production_batches (organization_id, period, created_at DESC);

DROP TRIGGER IF EXISTS trg_set_org_cost_allocation_centres ON public.cost_allocation_centres;
CREATE TRIGGER trg_set_org_cost_allocation_centres BEFORE INSERT ON public.cost_allocation_centres
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_cost_allocation_driver_values ON public.cost_allocation_driver_values;
CREATE TRIGGER trg_set_org_cost_allocation_driver_values BEFORE INSERT ON public.cost_allocation_driver_values
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_cost_allocation_rules ON public.cost_allocation_rules;
CREATE TRIGGER trg_set_org_cost_allocation_rules BEFORE INSERT ON public.cost_allocation_rules
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_cost_allocation_rule_centres ON public.cost_allocation_rule_centres;
CREATE TRIGGER trg_set_org_cost_allocation_rule_centres BEFORE INSERT ON public.cost_allocation_rule_centres
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_cost_allocation_runs ON public.cost_allocation_runs;
CREATE TRIGGER trg_set_org_cost_allocation_runs BEFORE INSERT ON public.cost_allocation_runs
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_cost_allocation_production_batches ON public.cost_allocation_production_batches;
CREATE TRIGGER trg_set_org_cost_allocation_production_batches BEFORE INSERT ON public.cost_allocation_production_batches
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

ALTER TABLE public.cost_allocation_centres ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_allocation_driver_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_allocation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_allocation_rule_centres ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_allocation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_allocation_production_batches ENABLE ROW LEVEL SECURITY;

DO $pol$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'cost_allocation_centres',
    'cost_allocation_driver_values',
    'cost_allocation_rules',
    'cost_allocation_rule_centres',
    'cost_allocation_runs',
    'cost_allocation_production_batches'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_tenant_all', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
       USING (public.is_platform_admin() OR (public.auth_staff_org_id() IS NOT NULL AND organization_id = public.auth_staff_org_id()))
       WITH CHECK (public.is_platform_admin() OR (public.auth_staff_org_id() IS NOT NULL AND organization_id = public.auth_staff_org_id()))',
      tbl || '_tenant_all',
      tbl
    );
  END LOOP;
END $pol$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cost_allocation_centres TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cost_allocation_driver_values TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cost_allocation_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cost_allocation_rule_centres TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cost_allocation_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cost_allocation_production_batches TO authenticated;
