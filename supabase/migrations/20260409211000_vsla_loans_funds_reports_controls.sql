-- VSLA phase 2: loans, repayments, funds, cashbox, share-out, reports support, and audit logs.

CREATE TABLE IF NOT EXISTS public.vsla_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.vsla_members(id) ON DELETE RESTRICT,
  guarantor_member_id uuid REFERENCES public.vsla_members(id) ON DELETE SET NULL,
  principal_amount numeric(18,2) NOT NULL CHECK (principal_amount > 0),
  interest_rate_percent numeric(9,4) NOT NULL DEFAULT 10 CHECK (interest_rate_percent >= 0),
  duration_meetings integer NOT NULL DEFAULT 4 CHECK (duration_meetings > 0),
  due_date date,
  status text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','approved','disbursed','closed','defaulted')),
  applied_at timestamptz NOT NULL DEFAULT now(),
  total_due numeric(18,2) NOT NULL DEFAULT 0,
  outstanding_balance numeric(18,2) NOT NULL DEFAULT 0,
  notes text
);

CREATE TABLE IF NOT EXISTS public.vsla_loan_repayments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meeting_id uuid REFERENCES public.vsla_meetings(id) ON DELETE SET NULL,
  loan_id uuid NOT NULL REFERENCES public.vsla_loans(id) ON DELETE CASCADE,
  principal_paid numeric(18,2) NOT NULL DEFAULT 0 CHECK (principal_paid >= 0),
  interest_paid numeric(18,2) NOT NULL DEFAULT 0 CHECK (interest_paid >= 0),
  penalty_paid numeric(18,2) NOT NULL DEFAULT 0 CHECK (penalty_paid >= 0),
  paid_on date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vsla_fines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meeting_id uuid REFERENCES public.vsla_meetings(id) ON DELETE SET NULL,
  member_id uuid NOT NULL REFERENCES public.vsla_members(id) ON DELETE RESTRICT,
  fine_type text NOT NULL CHECK (fine_type IN ('late_coming','absenteeism','misconduct')),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vsla_fund_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meeting_id uuid REFERENCES public.vsla_meetings(id) ON DELETE SET NULL,
  fund_type text NOT NULL CHECK (fund_type IN ('loan_fund','social_fund')),
  txn_type text NOT NULL CHECK (txn_type IN ('contribution','payout')),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vsla_cashbox_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meeting_id uuid REFERENCES public.vsla_meetings(id) ON DELETE SET NULL,
  opening_cash numeric(18,2) NOT NULL DEFAULT 0,
  inflow_savings numeric(18,2) NOT NULL DEFAULT 0,
  inflow_repayments numeric(18,2) NOT NULL DEFAULT 0,
  inflow_fines numeric(18,2) NOT NULL DEFAULT 0,
  outflow_loans numeric(18,2) NOT NULL DEFAULT 0,
  outflow_social_payouts numeric(18,2) NOT NULL DEFAULT 0,
  physical_cash numeric(18,2),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vsla_cycle_shareout (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  fund_total numeric(18,2) NOT NULL CHECK (fund_total >= 0),
  total_shares numeric(18,2) NOT NULL CHECK (total_shares >= 0),
  value_per_share numeric(18,6) NOT NULL CHECK (value_per_share >= 0),
  payout_sheet jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vsla_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id uuid,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id uuid,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vsla_meeting_transactions
  DROP CONSTRAINT IF EXISTS vsla_meeting_transactions_kind_check;
ALTER TABLE public.vsla_meeting_transactions
  ADD CONSTRAINT vsla_meeting_transactions_kind_check
  CHECK (kind IN ('loan_issue', 'loan_repayment', 'fine', 'social_payout'));

CREATE INDEX IF NOT EXISTS idx_vsla_loans_org ON public.vsla_loans (organization_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS idx_vsla_loan_repayments_org ON public.vsla_loan_repayments (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vsla_fines_org ON public.vsla_fines (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vsla_fund_txn_org ON public.vsla_fund_transactions (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vsla_cashbox_org ON public.vsla_cashbox_snapshots (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vsla_shareout_org ON public.vsla_cycle_shareout (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vsla_audit_org ON public.vsla_audit_logs (organization_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_set_org_vsla_loans ON public.vsla_loans;
CREATE TRIGGER trg_set_org_vsla_loans BEFORE INSERT ON public.vsla_loans
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_vsla_loan_repayments ON public.vsla_loan_repayments;
CREATE TRIGGER trg_set_org_vsla_loan_repayments BEFORE INSERT ON public.vsla_loan_repayments
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_vsla_fines ON public.vsla_fines;
CREATE TRIGGER trg_set_org_vsla_fines BEFORE INSERT ON public.vsla_fines
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_vsla_fund_txn ON public.vsla_fund_transactions;
CREATE TRIGGER trg_set_org_vsla_fund_txn BEFORE INSERT ON public.vsla_fund_transactions
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_vsla_cashbox ON public.vsla_cashbox_snapshots;
CREATE TRIGGER trg_set_org_vsla_cashbox BEFORE INSERT ON public.vsla_cashbox_snapshots
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_vsla_shareout ON public.vsla_cycle_shareout;
CREATE TRIGGER trg_set_org_vsla_shareout BEFORE INSERT ON public.vsla_cycle_shareout
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_vsla_audit ON public.vsla_audit_logs;
CREATE TRIGGER trg_set_org_vsla_audit BEFORE INSERT ON public.vsla_audit_logs
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

ALTER TABLE public.vsla_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vsla_loan_repayments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vsla_fines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vsla_fund_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vsla_cashbox_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vsla_cycle_shareout ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vsla_audit_logs ENABLE ROW LEVEL SECURITY;

DO $pol$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'vsla_loans',
    'vsla_loan_repayments',
    'vsla_fines',
    'vsla_fund_transactions',
    'vsla_cashbox_snapshots',
    'vsla_cycle_shareout',
    'vsla_audit_logs'
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vsla_loans TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vsla_loan_repayments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vsla_fines TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vsla_fund_transactions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vsla_cashbox_snapshots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vsla_cycle_shareout TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vsla_audit_logs TO authenticated;
