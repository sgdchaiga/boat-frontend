-- Payroll: employee profiles, statutory config, loans, periods, runs, payslip lines, GL posting

CREATE OR REPLACE FUNCTION public.set_payroll_org_from_staff_row()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE oid uuid;
BEGIN
  SELECT s.organization_id INTO oid FROM public.staff s WHERE s.id = NEW.staff_id;
  IF oid IS NULL THEN RAISE EXCEPTION 'Staff not found or has no organization'; END IF;
  NEW.organization_id := oid;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.set_payroll_line_org_from_run()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE oid uuid;
BEGIN
  SELECT r.organization_id INTO oid FROM public.payroll_runs r WHERE r.id = NEW.payroll_run_id;
  IF oid IS NULL THEN RAISE EXCEPTION 'Payroll run not found'; END IF;
  NEW.organization_id := oid;
  RETURN NEW;
END; $$;

-- Per-organization payroll & GL mapping (one row per org; insert on first use from app)
CREATE TABLE IF NOT EXISTS public.payroll_org_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  paye_personal_relief_monthly numeric(18,2) NOT NULL DEFAULT 235000,
  paye_taxable_band_1_limit numeric(18,2) NOT NULL DEFAULT 235000,
  paye_rate_band_1_pct numeric(8,4) NOT NULL DEFAULT 0,
  paye_rate_above_band_1_pct numeric(8,4) NOT NULL DEFAULT 30,
  nssf_employee_rate_pct numeric(8,4) NOT NULL DEFAULT 5,
  nssf_employer_rate_pct numeric(8,4) NOT NULL DEFAULT 10,
  nssf_gross_ceiling numeric(18,2),
  salary_expense_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  paye_payable_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  nssf_payable_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  salaries_payable_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  staff_loan_receivable_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payroll_employee_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  employee_code text,
  department text,
  job_title text,
  base_salary numeric(18,2) NOT NULL DEFAULT 0 CHECK (base_salary >= 0),
  housing_allowance numeric(18,2) NOT NULL DEFAULT 0 CHECK (housing_allowance >= 0),
  transport_allowance numeric(18,2) NOT NULL DEFAULT 0 CHECK (transport_allowance >= 0),
  other_allowances jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_on_payroll boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_employee_profiles_org_staff_unique UNIQUE (organization_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_employee_profiles_org ON public.payroll_employee_profiles (organization_id);
CREATE INDEX IF NOT EXISTS idx_payroll_employee_profiles_staff ON public.payroll_employee_profiles (staff_id);

CREATE TABLE IF NOT EXISTS public.payroll_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  reference text,
  principal_amount numeric(18,2) NOT NULL CHECK (principal_amount > 0),
  balance_remaining numeric(18,2) NOT NULL CHECK (balance_remaining >= 0),
  installment_amount numeric(18,2) NOT NULL CHECK (installment_amount >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payroll_loans_org ON public.payroll_loans (organization_id);
CREATE INDEX IF NOT EXISTS idx_payroll_loans_staff ON public.payroll_loans (staff_id);

CREATE TABLE IF NOT EXISTS public.payroll_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_periods_range_ok CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_payroll_periods_org ON public.payroll_periods (organization_id, period_start, period_end);

CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payroll_period_id uuid NOT NULL REFERENCES public.payroll_periods(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'calculated', 'posted')),
  journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  calculated_at timestamptz,
  posted_at timestamptz,
  posted_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_runs_one_per_period UNIQUE (payroll_period_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_org ON public.payroll_runs (organization_id);

CREATE TABLE IF NOT EXISTS public.payroll_run_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payroll_run_id uuid NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  gross_pay numeric(18,2) NOT NULL DEFAULT 0,
  taxable_income numeric(18,2) NOT NULL DEFAULT 0,
  paye numeric(18,2) NOT NULL DEFAULT 0,
  nssf_employee numeric(18,2) NOT NULL DEFAULT 0,
  nssf_employer numeric(18,2) NOT NULL DEFAULT 0,
  loan_deduction numeric(18,2) NOT NULL DEFAULT 0,
  net_pay numeric(18,2) NOT NULL DEFAULT 0,
  line_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_run_lines_run_staff_unique UNIQUE (payroll_run_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_run_lines_run ON public.payroll_run_lines (payroll_run_id);

DROP TRIGGER IF EXISTS trg_set_org_payroll_org_settings ON public.payroll_org_settings;
CREATE TRIGGER trg_set_org_payroll_org_settings BEFORE INSERT ON public.payroll_org_settings
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

CREATE OR REPLACE FUNCTION public.payroll_employee_profiles_before_ins()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE oid uuid;
BEGIN
  SELECT s.organization_id INTO oid FROM public.staff s WHERE s.id = NEW.staff_id;
  IF oid IS NULL THEN RAISE EXCEPTION 'Staff not found or has no organization'; END IF;
  NEW.organization_id := oid;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_payroll_employee_profiles_bi ON public.payroll_employee_profiles;
CREATE TRIGGER trg_payroll_employee_profiles_bi BEFORE INSERT ON public.payroll_employee_profiles
FOR EACH ROW EXECUTE FUNCTION public.payroll_employee_profiles_before_ins();

DROP TRIGGER IF EXISTS trg_payroll_loans_org ON public.payroll_loans;
CREATE TRIGGER trg_payroll_loans_org BEFORE INSERT ON public.payroll_loans
FOR EACH ROW EXECUTE FUNCTION public.set_payroll_org_from_staff_row();

DROP TRIGGER IF EXISTS trg_set_org_payroll_periods ON public.payroll_periods;
CREATE TRIGGER trg_set_org_payroll_periods BEFORE INSERT ON public.payroll_periods
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

CREATE OR REPLACE FUNCTION public.payroll_runs_org_from_period()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT p.organization_id INTO NEW.organization_id FROM public.payroll_periods p WHERE p.id = NEW.payroll_period_id;
  IF NEW.organization_id IS NULL THEN RAISE EXCEPTION 'Payroll period not found'; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_payroll_runs_org_from_period ON public.payroll_runs;
CREATE TRIGGER trg_payroll_runs_org_from_period BEFORE INSERT ON public.payroll_runs
FOR EACH ROW EXECUTE FUNCTION public.payroll_runs_org_from_period();

DROP TRIGGER IF EXISTS trg_payroll_run_lines_org ON public.payroll_run_lines;
CREATE TRIGGER trg_payroll_run_lines_org BEFORE INSERT ON public.payroll_run_lines
FOR EACH ROW EXECUTE FUNCTION public.set_payroll_line_org_from_run();

ALTER TABLE public.payroll_org_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_employee_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_run_lines ENABLE ROW LEVEL SECURITY;

DO $pol$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'payroll_org_settings',
    'payroll_employee_profiles',
    'payroll_loans',
    'payroll_periods',
    'payroll_runs',
    'payroll_run_lines'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_select_same_org', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_write_same_org', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (
        organization_id IS NOT NULL AND organization_id = (
          SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
        )
      )',
      tbl || '_select_same_org',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (
        organization_id IS NOT NULL AND organization_id = (
          SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
        )
      ) WITH CHECK (
        organization_id IS NOT NULL AND organization_id = (
          SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
        )
      )',
      tbl || '_write_same_org',
      tbl
    );
  END LOOP;
END $pol$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_org_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_employee_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_loans TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_periods TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_run_lines TO authenticated;

COMMENT ON TABLE public.payroll_org_settings IS 'Payroll statutory defaults and GL accounts for journal posting.';
COMMENT ON TABLE public.payroll_employee_profiles IS 'Salary and allowances per staff member for payroll.';
COMMENT ON TABLE public.payroll_loans IS 'Staff salary advances / loans recovered via payroll.';
COMMENT ON TABLE public.payroll_periods IS 'Payroll calendar periods (e.g. monthly).';
COMMENT ON TABLE public.payroll_runs IS 'One calculated run per period; posted journal optional.';
COMMENT ON TABLE public.payroll_run_lines IS 'Payslip lines for a payroll run.';
