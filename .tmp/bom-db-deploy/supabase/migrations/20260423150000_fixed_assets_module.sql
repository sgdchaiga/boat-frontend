-- Fixed assets module: org flag, GL slots, register, depreciation runs, lifecycle events

-- 1) Feature flag (superuser toggles per organization)
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS enable_fixed_assets boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.enable_fixed_assets IS
  'When true, staff see Fixed assets in Accounting. Superuser enables per business.';

-- 2) GL mapping for automated FA journals
ALTER TABLE public.journal_gl_settings
  ADD COLUMN IF NOT EXISTS fixed_asset_cost_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.journal_gl_settings
  ADD COLUMN IF NOT EXISTS accumulated_depreciation_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.journal_gl_settings
  ADD COLUMN IF NOT EXISTS depreciation_expense_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.journal_gl_settings
  ADD COLUMN IF NOT EXISTS revaluation_reserve_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.journal_gl_settings
  ADD COLUMN IF NOT EXISTS impairment_loss_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.journal_gl_settings
  ADD COLUMN IF NOT EXISTS gain_on_disposal_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.journal_gl_settings
  ADD COLUMN IF NOT EXISTS loss_on_disposal_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.journal_gl_settings.fixed_asset_cost_gl_account_id IS 'PPE / fixed assets at cost (debit on capitalization).';
COMMENT ON COLUMN public.journal_gl_settings.accumulated_depreciation_gl_account_id IS 'Contra-asset: accumulated depreciation.';
COMMENT ON COLUMN public.journal_gl_settings.depreciation_expense_gl_account_id IS 'Depreciation expense (P&L).';
COMMENT ON COLUMN public.journal_gl_settings.revaluation_reserve_gl_account_id IS 'OCI / revaluation surplus (equity).';
COMMENT ON COLUMN public.journal_gl_settings.impairment_loss_gl_account_id IS 'Impairment loss (P&L).';
COMMENT ON COLUMN public.journal_gl_settings.gain_on_disposal_gl_account_id IS 'Gain on disposal (income).';
COMMENT ON COLUMN public.journal_gl_settings.loss_on_disposal_gl_account_id IS 'Loss on disposal (expense).';

-- 3) Categories (hierarchical: parent = category, child = sub-category)
CREATE TABLE IF NOT EXISTS public.fixed_asset_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.fixed_asset_categories(id) ON DELETE SET NULL,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixed_asset_categories_no_self_parent CHECK (parent_id IS DISTINCT FROM id)
);

CREATE INDEX IF NOT EXISTS idx_fixed_asset_categories_org ON public.fixed_asset_categories(organization_id);
CREATE INDEX IF NOT EXISTS idx_fixed_asset_categories_parent ON public.fixed_asset_categories(parent_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fixed_asset_categories_org_parent_name
  ON public.fixed_asset_categories (
    organization_id,
    (COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    lower(name)
  );

-- 4) Asset register
CREATE TABLE IF NOT EXISTS public.fixed_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  asset_code text NOT NULL,
  barcode text,
  qr_code_payload text,
  name text NOT NULL,
  description text,
  category_id uuid REFERENCES public.fixed_asset_categories(id) ON DELETE SET NULL,
  branch_name text,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  room_or_location text,
  custodian_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  custodian_name text,
  supplier_name text,
  invoice_reference text,
  purchase_date date,
  cost numeric(15,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  funding_source text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'capitalized', 'disposed')),
  depreciation_method text NOT NULL DEFAULT 'straight_line'
    CHECK (depreciation_method IN ('straight_line', 'reducing_balance', 'units_of_production')),
  useful_life_months int CHECK (useful_life_months IS NULL OR useful_life_months > 0),
  residual_value numeric(15,2) NOT NULL DEFAULT 0 CHECK (residual_value >= 0),
  reducing_balance_rate_percent numeric(10,4) CHECK (reducing_balance_rate_percent IS NULL OR reducing_balance_rate_percent > 0),
  units_total numeric(18,4) CHECK (units_total IS NULL OR units_total > 0),
  units_produced_to_date numeric(18,4) NOT NULL DEFAULT 0 CHECK (units_produced_to_date >= 0),
  depreciation_frequency text NOT NULL DEFAULT 'monthly' CHECK (depreciation_frequency IN ('monthly', 'yearly')),
  in_service_date date,
  last_depreciation_period_end date,
  accumulated_depreciation numeric(15,2) NOT NULL DEFAULT 0 CHECK (accumulated_depreciation >= 0),
  revaluation_adjustment numeric(15,2) NOT NULL DEFAULT 0,
  impairment_loss_accumulated numeric(15,2) NOT NULL DEFAULT 0 CHECK (impairment_loss_accumulated >= 0),
  capitalized_journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  disposal_journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  disposed_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, asset_code)
);

CREATE INDEX IF NOT EXISTS idx_fixed_assets_org ON public.fixed_assets(organization_id);
CREATE INDEX IF NOT EXISTS idx_fixed_assets_status ON public.fixed_assets(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_fixed_assets_category ON public.fixed_assets(category_id);

-- 5) Lifecycle & audit events
CREATE TABLE IF NOT EXISTS public.fixed_asset_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.fixed_assets(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'acquisition', 'capitalization', 'transfer', 'revaluation', 'impairment', 'depreciation', 'disposal'
  )),
  event_date date NOT NULL,
  notes text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fixed_asset_events_org ON public.fixed_asset_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_fixed_asset_events_asset ON public.fixed_asset_events(asset_id);

-- 6) Depreciation batch runs
CREATE TABLE IF NOT EXISTS public.fixed_asset_depreciation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  frequency text NOT NULL CHECK (frequency IN ('monthly', 'yearly')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'failed')),
  journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  total_amount numeric(15,2),
  error_message text,
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixed_asset_depreciation_runs_period_order CHECK (period_end >= period_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fa_dep_run_posted_period
  ON public.fixed_asset_depreciation_runs (organization_id, period_end, frequency)
  WHERE status = 'posted';

CREATE INDEX IF NOT EXISTS idx_fa_dep_runs_org ON public.fixed_asset_depreciation_runs(organization_id);

CREATE TABLE IF NOT EXISTS public.fixed_asset_depreciation_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.fixed_asset_depreciation_runs(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.fixed_assets(id) ON DELETE CASCADE,
  amount numeric(15,2) NOT NULL,
  units_in_period numeric(18,4),
  pro_rata_factor numeric(14,8),
  note text,
  UNIQUE (run_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_fa_dep_lines_run ON public.fixed_asset_depreciation_lines(run_id);

-- 7) RLS — same org as staff
ALTER TABLE public.fixed_asset_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixed_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixed_asset_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixed_asset_depreciation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixed_asset_depreciation_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fa_categories_org" ON public.fixed_asset_categories;
CREATE POLICY "fa_categories_org"
  ON public.fixed_asset_categories FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = (SELECT auth.uid()) AND s.organization_id = fixed_asset_categories.organization_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = (SELECT auth.uid()) AND s.organization_id = fixed_asset_categories.organization_id
    )
  );

DROP POLICY IF EXISTS "fa_assets_org" ON public.fixed_assets;
CREATE POLICY "fa_assets_org"
  ON public.fixed_assets FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = (SELECT auth.uid()) AND s.organization_id = fixed_assets.organization_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = (SELECT auth.uid()) AND s.organization_id = fixed_assets.organization_id
    )
  );

DROP POLICY IF EXISTS "fa_events_org" ON public.fixed_asset_events;
CREATE POLICY "fa_events_org"
  ON public.fixed_asset_events FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = (SELECT auth.uid()) AND s.organization_id = fixed_asset_events.organization_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = (SELECT auth.uid()) AND s.organization_id = fixed_asset_events.organization_id
    )
  );

DROP POLICY IF EXISTS "fa_dep_runs_org" ON public.fixed_asset_depreciation_runs;
CREATE POLICY "fa_dep_runs_org"
  ON public.fixed_asset_depreciation_runs FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = (SELECT auth.uid()) AND s.organization_id = fixed_asset_depreciation_runs.organization_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = (SELECT auth.uid()) AND s.organization_id = fixed_asset_depreciation_runs.organization_id
    )
  );

DROP POLICY IF EXISTS "fa_dep_lines_org" ON public.fixed_asset_depreciation_lines;
CREATE POLICY "fa_dep_lines_org"
  ON public.fixed_asset_depreciation_lines FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.fixed_asset_depreciation_runs r
      JOIN public.staff s ON s.organization_id = r.organization_id AND s.id = (SELECT auth.uid())
      WHERE r.id = fixed_asset_depreciation_lines.run_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.fixed_asset_depreciation_runs r
      JOIN public.staff s ON s.organization_id = r.organization_id AND s.id = (SELECT auth.uid())
      WHERE r.id = fixed_asset_depreciation_lines.run_id
    )
  );

-- Platform admins: full access (inherits from org policies may not apply — add explicit)
DROP POLICY IF EXISTS "fa_categories_platform" ON public.fixed_asset_categories;
CREATE POLICY "fa_categories_platform"
  ON public.fixed_asset_categories FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "fa_assets_platform" ON public.fixed_assets;
CREATE POLICY "fa_assets_platform"
  ON public.fixed_assets FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "fa_events_platform" ON public.fixed_asset_events;
CREATE POLICY "fa_events_platform"
  ON public.fixed_asset_events FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "fa_dep_runs_platform" ON public.fixed_asset_depreciation_runs;
CREATE POLICY "fa_dep_runs_platform"
  ON public.fixed_asset_depreciation_runs FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "fa_dep_lines_platform" ON public.fixed_asset_depreciation_lines;
CREATE POLICY "fa_dep_lines_platform"
  ON public.fixed_asset_depreciation_lines FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());
