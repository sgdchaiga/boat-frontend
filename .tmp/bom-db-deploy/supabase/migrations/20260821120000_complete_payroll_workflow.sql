-- Complete payroll workflow: review, payment, statutory remittance and richer employee records.

ALTER TABLE public.payroll_employee_profiles
  ADD COLUMN IF NOT EXISTS staff_type text,
  ADD COLUMN IF NOT EXISTS date_joined date,
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS bank_account_number text,
  ADD COLUMN IF NOT EXISTS mobile_money_number text,
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'bank',
  ADD COLUMN IF NOT EXISTS tin text,
  ADD COLUMN IF NOT EXISTS nssf_number text,
  ADD COLUMN IF NOT EXISTS responsibility_allowance numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recurring_deductions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS salary_grade text;

ALTER TABLE public.payroll_employee_profiles DROP CONSTRAINT IF EXISTS payroll_employee_profiles_payment_method_check;
ALTER TABLE public.payroll_employee_profiles ADD CONSTRAINT payroll_employee_profiles_payment_method_check
  CHECK (payment_method IN ('bank', 'mobile_money', 'cash'));

ALTER TABLE public.payroll_runs DROP CONSTRAINT IF EXISTS payroll_runs_status_check;
ALTER TABLE public.payroll_runs ADD CONSTRAINT payroll_runs_status_check
  CHECK (status IN ('draft', 'calculated', 'under_review', 'approved', 'paid', 'posted', 'reversed'));
ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_notes text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversal_reason text;

CREATE TABLE IF NOT EXISTS public.payroll_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payroll_run_id uuid NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  amount numeric(18,2) NOT NULL CHECK (amount >= 0),
  payment_method text NOT NULL CHECK (payment_method IN ('bank', 'mobile_money', 'cash')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'paid', 'failed', 'returned')),
  payment_reference text,
  failure_reason text,
  paid_at timestamptz,
  payslip_distributed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_payments_run_staff_unique UNIQUE (payroll_run_id, staff_id)
);

CREATE TABLE IF NOT EXISTS public.payroll_statutory_remittances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payroll_run_id uuid NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  liability_type text NOT NULL CHECK (liability_type IN ('paye', 'nssf_employee', 'nssf_employer', 'lst', 'other')),
  amount_calculated numeric(18,2) NOT NULL DEFAULT 0,
  amount_paid numeric(18,2) NOT NULL DEFAULT 0,
  due_date date,
  payment_reference text,
  paid_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_statutory_run_type_unique UNIQUE (payroll_run_id, liability_type)
);

CREATE INDEX IF NOT EXISTS idx_payroll_payments_org_run ON public.payroll_payments (organization_id, payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_statutory_org_run ON public.payroll_statutory_remittances (organization_id, payroll_run_id);

CREATE OR REPLACE FUNCTION public.payroll_child_org_from_run()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT organization_id INTO NEW.organization_id FROM public.payroll_runs WHERE id = NEW.payroll_run_id;
  IF NEW.organization_id IS NULL THEN RAISE EXCEPTION 'Payroll run not found'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_payroll_payments_org ON public.payroll_payments;
CREATE TRIGGER trg_payroll_payments_org BEFORE INSERT OR UPDATE ON public.payroll_payments
FOR EACH ROW EXECUTE FUNCTION public.payroll_child_org_from_run();
DROP TRIGGER IF EXISTS trg_payroll_statutory_org ON public.payroll_statutory_remittances;
CREATE TRIGGER trg_payroll_statutory_org BEFORE INSERT OR UPDATE ON public.payroll_statutory_remittances
FOR EACH ROW EXECUTE FUNCTION public.payroll_child_org_from_run();

ALTER TABLE public.payroll_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_statutory_remittances ENABLE ROW LEVEL SECURITY;

DO $pol$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['payroll_payments', 'payroll_statutory_remittances'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_same_org', tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (
      organization_id = (SELECT organization_id FROM public.staff WHERE id = auth.uid())
    ) WITH CHECK (
      organization_id = (SELECT organization_id FROM public.staff WHERE id = auth.uid())
    )', tbl || '_same_org', tbl);
  END LOOP;
END $pol$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_payments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_statutory_remittances TO authenticated;

COMMENT ON TABLE public.payroll_payments IS 'Employee-level payment execution and exception tracking for payroll runs.';
COMMENT ON TABLE public.payroll_statutory_remittances IS 'Calculated and remitted payroll statutory liabilities by run.';
