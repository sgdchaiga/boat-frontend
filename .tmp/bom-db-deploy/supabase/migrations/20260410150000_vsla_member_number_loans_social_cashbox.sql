-- VSLA upgrades:
-- - member_number on members
-- - loan disbursement/accrual fields
-- - social fund loan tables
-- - meeting transaction kinds for chairman basket and refreshments

ALTER TABLE public.vsla_members
  ADD COLUMN IF NOT EXISTS member_number text;

UPDATE public.vsla_members
SET member_number = NULLIF(trim(household_id), '')
WHERE member_number IS NULL AND household_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vsla_members_org_member_number
  ON public.vsla_members (organization_id, member_number)
  WHERE member_number IS NOT NULL;

ALTER TABLE public.vsla_loans
  ADD COLUMN IF NOT EXISTS interest_type text NOT NULL DEFAULT 'flat'
    CHECK (interest_type IN ('flat', 'declining'));

ALTER TABLE public.vsla_loans
  ADD COLUMN IF NOT EXISTS disbursed_on date;

ALTER TABLE public.vsla_meeting_transactions
  DROP CONSTRAINT IF EXISTS vsla_meeting_transactions_kind_check;

ALTER TABLE public.vsla_meeting_transactions
  ADD CONSTRAINT vsla_meeting_transactions_kind_check
  CHECK (
    kind IN (
      'loan_issue',
      'loan_repayment',
      'fine',
      'social_payout',
      'chairman_basket',
      'refreshments'
    )
  );

CREATE TABLE IF NOT EXISTS public.vsla_social_fund_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.vsla_members(id) ON DELETE RESTRICT,
  meeting_id uuid REFERENCES public.vsla_meetings(id) ON DELETE SET NULL,
  principal_amount numeric(18,2) NOT NULL CHECK (principal_amount > 0),
  interest_rate_percent numeric(9,4) NOT NULL DEFAULT 0 CHECK (interest_rate_percent >= 0),
  interest_type text NOT NULL DEFAULT 'flat' CHECK (interest_type IN ('flat', 'declining')),
  duration_months integer NOT NULL DEFAULT 12 CHECK (duration_months > 0),
  interest_start_month integer NOT NULL DEFAULT 2 CHECK (interest_start_month >= 1),
  disbursed_on date,
  status text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'disbursed', 'closed', 'defaulted')),
  total_due numeric(18,2) NOT NULL DEFAULT 0,
  outstanding_balance numeric(18,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vsla_social_fund_loan_repayments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  social_fund_loan_id uuid NOT NULL REFERENCES public.vsla_social_fund_loans(id) ON DELETE CASCADE,
  meeting_id uuid REFERENCES public.vsla_meetings(id) ON DELETE SET NULL,
  principal_paid numeric(18,2) NOT NULL DEFAULT 0 CHECK (principal_paid >= 0),
  interest_paid numeric(18,2) NOT NULL DEFAULT 0 CHECK (interest_paid >= 0),
  penalty_paid numeric(18,2) NOT NULL DEFAULT 0 CHECK (penalty_paid >= 0),
  paid_on date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vsla_social_fund_loans_org
  ON public.vsla_social_fund_loans (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vsla_social_fund_loan_repayments_org
  ON public.vsla_social_fund_loan_repayments (organization_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_vsla_social_fund_loans_touch ON public.vsla_social_fund_loans;
CREATE TRIGGER trg_vsla_social_fund_loans_touch BEFORE UPDATE ON public.vsla_social_fund_loans
FOR EACH ROW EXECUTE FUNCTION public.touch_vsla_updated_at();

DROP TRIGGER IF EXISTS trg_set_org_vsla_social_fund_loans ON public.vsla_social_fund_loans;
CREATE TRIGGER trg_set_org_vsla_social_fund_loans BEFORE INSERT ON public.vsla_social_fund_loans
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_vsla_social_fund_loan_repayments ON public.vsla_social_fund_loan_repayments;
CREATE TRIGGER trg_set_org_vsla_social_fund_loan_repayments BEFORE INSERT ON public.vsla_social_fund_loan_repayments
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

ALTER TABLE public.vsla_social_fund_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vsla_social_fund_loan_repayments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vsla_social_fund_loans_tenant_all ON public.vsla_social_fund_loans;
CREATE POLICY vsla_social_fund_loans_tenant_all ON public.vsla_social_fund_loans
FOR ALL TO authenticated
USING (public.is_platform_admin() OR (public.auth_staff_org_id() IS NOT NULL AND organization_id = public.auth_staff_org_id()))
WITH CHECK (public.is_platform_admin() OR (public.auth_staff_org_id() IS NOT NULL AND organization_id = public.auth_staff_org_id()));

DROP POLICY IF EXISTS vsla_social_fund_loan_repayments_tenant_all ON public.vsla_social_fund_loan_repayments;
CREATE POLICY vsla_social_fund_loan_repayments_tenant_all ON public.vsla_social_fund_loan_repayments
FOR ALL TO authenticated
USING (public.is_platform_admin() OR (public.auth_staff_org_id() IS NOT NULL AND organization_id = public.auth_staff_org_id()))
WITH CHECK (public.is_platform_admin() OR (public.auth_staff_org_id() IS NOT NULL AND organization_id = public.auth_staff_org_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vsla_social_fund_loans TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vsla_social_fund_loan_repayments TO authenticated;
