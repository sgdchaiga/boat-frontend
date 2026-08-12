ALTER TABLE public.payroll_loans
  ADD COLUMN IF NOT EXISTS interest_method text NOT NULL DEFAULT 'flat',
  ADD COLUMN IF NOT EXISTS interest_rate_pct numeric(9,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS term_months integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS total_repayable numeric(18,2),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.staff(id) ON DELETE SET NULL;

UPDATE public.payroll_loans
SET total_repayable = COALESCE(total_repayable, principal_amount),
    status = CASE WHEN NOT is_active AND balance_remaining <= 0.01 THEN 'completed' ELSE status END;

ALTER TABLE public.payroll_loans ALTER COLUMN total_repayable SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE public.payroll_loans ADD CONSTRAINT payroll_loans_interest_method_check CHECK (interest_method IN ('flat','declining'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.payroll_loans ADD CONSTRAINT payroll_loans_status_check CHECK (status IN ('active','completed','cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.payroll_loans ADD CONSTRAINT payroll_loans_term_check CHECK (term_months > 0 AND interest_rate_pct >= 0 AND total_repayable >= principal_amount);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
