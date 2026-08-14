-- SACCO: org loan policy (min savings days), loan modifications audit, write-off & recovery tracking.

-- Org-level rule: min days after first ordinary savings account before loan application.
CREATE TABLE IF NOT EXISTS public.sacco_org_loan_policies (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  min_savings_days_before_loan int NOT NULL DEFAULT 30,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_sacco_org_loan_policies_touch ON public.sacco_org_loan_policies;
CREATE TRIGGER trg_sacco_org_loan_policies_touch
BEFORE UPDATE ON public.sacco_org_loan_policies
FOR EACH ROW
EXECUTE FUNCTION public.touch_sacco_loan_products_updated_at();

ALTER TABLE public.sacco_org_loan_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sacco_org_loan_policies_org" ON public.sacco_org_loan_policies;
CREATE POLICY "sacco_org_loan_policies_org"
  ON public.sacco_org_loan_policies FOR ALL TO authenticated
  USING (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
  WITH CHECK (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sacco_org_loan_policies TO authenticated;

COMMENT ON TABLE public.sacco_org_loan_policies IS 'SACCO loan governance: cooling-off after first savings account, etc.';

-- Loan modifications audit (reschedule / restructure).
CREATE TABLE IF NOT EXISTS public.sacco_loan_modifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sacco_loan_id uuid NOT NULL REFERENCES public.sacco_loans(id) ON DELETE CASCADE,
  modification_type text NOT NULL CHECK (modification_type IN ('reschedule', 'restructure', 'write_off', 'recovery_writeoff')),
  effective_date date NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,
  notes text,
  previous_term_months int,
  new_term_months int,
  previous_interest_rate numeric,
  new_interest_rate numeric,
  previous_monthly_payment numeric,
  new_monthly_payment numeric,
  previous_balance numeric,
  new_balance numeric,
  amount_money numeric DEFAULT 0,
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sacco_loan_mods_loan ON public.sacco_loan_modifications (sacco_loan_id);
CREATE INDEX IF NOT EXISTS idx_sacco_loan_mods_org ON public.sacco_loan_modifications (organization_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_set_org_sacco_loan_mods ON public.sacco_loan_modifications;
CREATE TRIGGER trg_set_org_sacco_loan_mods
BEFORE INSERT ON public.sacco_loan_modifications
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

ALTER TABLE public.sacco_loan_modifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sacco_loan_mods_org" ON public.sacco_loan_modifications;
CREATE POLICY "sacco_loan_mods_org"
  ON public.sacco_loan_modifications FOR ALL TO authenticated
  USING (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
  WITH CHECK (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sacco_loan_modifications TO authenticated;

-- sacco_loans: write-off balances + widen status for written_off
ALTER TABLE public.sacco_loans
  DROP CONSTRAINT IF EXISTS sacco_loans_status_check;

ALTER TABLE public.sacco_loans
  ADD CONSTRAINT sacco_loans_status_check CHECK (
    status IN ('pending', 'approved', 'disbursed', 'closed', 'rejected', 'defaulted', 'written_off')
  );

ALTER TABLE public.sacco_loans
  ADD COLUMN IF NOT EXISTS written_off_remaining numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS written_off_total numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS written_off_at date;

COMMENT ON COLUMN public.sacco_loans.written_off_total IS 'Cumulative principal (and approved interest) formally written off — audit.';
COMMENT ON COLUMN public.sacco_loans.written_off_remaining IS 'Portion still outstanding as bad debt recoverable — reduced when recoveries post.';
COMMENT ON COLUMN public.sacco_loans.written_off_at IS 'Last write-off event date.';

