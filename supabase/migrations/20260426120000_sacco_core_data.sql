-- SACCO workspace: loans, products, fixed deposits, cashbook lines, fixed assets (module snapshot), provisioning.
-- Mirrors AppContext shapes; RLS same-org as sacco_members.

-- Optional member balances for dashboard / loan eligibility (defaults for existing rows)
ALTER TABLE public.sacco_members
  ADD COLUMN IF NOT EXISTS savings_balance numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shares_balance numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS join_date date;

UPDATE public.sacco_members SET join_date = (created_at AT TIME ZONE 'UTC')::date WHERE join_date IS NULL;

-- ---------- sacco_loan_products ----------
CREATE TABLE IF NOT EXISTS public.sacco_loan_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  interest_rate numeric NOT NULL,
  max_term_months int NOT NULL,
  min_amount numeric NOT NULL,
  max_amount numeric NOT NULL,
  interest_basis text NOT NULL CHECK (interest_basis IN ('flat', 'declining')),
  fees jsonb NOT NULL DEFAULT '{}',
  compulsory_savings_rate numeric NOT NULL DEFAULT 0,
  minimum_shares numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sacco_loan_products_org_name_unique UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_sacco_loan_products_org ON public.sacco_loan_products (organization_id);

DROP TRIGGER IF EXISTS trg_set_org_sacco_loan_products ON public.sacco_loan_products;
CREATE TRIGGER trg_set_org_sacco_loan_products
BEFORE INSERT ON public.sacco_loan_products
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

CREATE OR REPLACE FUNCTION public.touch_sacco_loan_products_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_sacco_loan_products_touch ON public.sacco_loan_products;
CREATE TRIGGER trg_sacco_loan_products_touch
BEFORE UPDATE ON public.sacco_loan_products
FOR EACH ROW EXECUTE FUNCTION public.touch_sacco_loan_products_updated_at();

-- ---------- sacco_loans ----------
CREATE TABLE IF NOT EXISTS public.sacco_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sacco_member_id uuid NOT NULL REFERENCES public.sacco_members(id) ON DELETE RESTRICT,
  member_name text NOT NULL,
  loan_type text NOT NULL,
  amount numeric NOT NULL,
  balance numeric NOT NULL,
  paid_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'disbursed', 'closed', 'rejected', 'defaulted')),
  interest_rate numeric NOT NULL,
  term_months int NOT NULL,
  monthly_payment numeric NOT NULL,
  approval_stage int NOT NULL DEFAULT 0,
  purpose text NOT NULL DEFAULT '',
  guarantors jsonb NOT NULL DEFAULT '[]',
  application_date date NOT NULL,
  interest_basis text NOT NULL CHECK (interest_basis IN ('flat', 'declining')),
  disbursement_date date,
  fees jsonb,
  collateral_description text,
  lc1_chairman_name text,
  lc1_chairman_phone text,
  last_payment_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sacco_loans_org ON public.sacco_loans (organization_id);
CREATE INDEX IF NOT EXISTS idx_sacco_loans_member ON public.sacco_loans (sacco_member_id);
CREATE INDEX IF NOT EXISTS idx_sacco_loans_status ON public.sacco_loans (organization_id, status);

DROP TRIGGER IF EXISTS trg_set_org_sacco_loans ON public.sacco_loans;
CREATE TRIGGER trg_set_org_sacco_loans
BEFORE INSERT ON public.sacco_loans
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

CREATE OR REPLACE FUNCTION public.touch_sacco_loans_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_sacco_loans_touch ON public.sacco_loans;
CREATE TRIGGER trg_sacco_loans_touch
BEFORE UPDATE ON public.sacco_loans
FOR EACH ROW EXECUTE FUNCTION public.touch_sacco_loans_updated_at();

COMMENT ON COLUMN public.sacco_loans.collateral_description IS 'Description of collateral offered for the loan.';
COMMENT ON COLUMN public.sacco_loans.lc1_chairman_name IS 'Local Council I chairperson name (collateral / locality verification).';
COMMENT ON COLUMN public.sacco_loans.lc1_chairman_phone IS 'LC1 chairperson telephone.';
COMMENT ON COLUMN public.sacco_loans.last_payment_date IS 'Most recent repayment date; set when payments are recorded.';

-- ---------- sacco_fixed_deposits ----------
CREATE TABLE IF NOT EXISTS public.sacco_fixed_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sacco_member_id uuid NOT NULL REFERENCES public.sacco_members(id) ON DELETE CASCADE,
  member_name text NOT NULL,
  amount numeric NOT NULL,
  interest_rate numeric NOT NULL,
  term_months int NOT NULL,
  start_date date NOT NULL,
  maturity_date date NOT NULL,
  interest_earned numeric NOT NULL DEFAULT 0,
  auto_renew boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sacco_fd_org ON public.sacco_fixed_deposits (organization_id);

DROP TRIGGER IF EXISTS trg_set_org_sacco_fixed_deposits ON public.sacco_fixed_deposits;
CREATE TRIGGER trg_set_org_sacco_fixed_deposits
BEFORE INSERT ON public.sacco_fixed_deposits
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

CREATE OR REPLACE FUNCTION public.touch_sacco_fd_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_sacco_fd_touch ON public.sacco_fixed_deposits;
CREATE TRIGGER trg_sacco_fd_touch
BEFORE UPDATE ON public.sacco_fixed_deposits
FOR EACH ROW EXECUTE FUNCTION public.touch_sacco_fd_updated_at();

-- ---------- sacco_cashbook_entries ----------
CREATE TABLE IF NOT EXISTS public.sacco_cashbook_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  description text NOT NULL,
  reference text,
  category text,
  sacco_member_id uuid REFERENCES public.sacco_members(id) ON DELETE SET NULL,
  member_name text,
  debit numeric NOT NULL DEFAULT 0,
  credit numeric NOT NULL DEFAULT 0,
  balance numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sacco_cb_org ON public.sacco_cashbook_entries (organization_id, entry_date);

DROP TRIGGER IF EXISTS trg_set_org_sacco_cashbook ON public.sacco_cashbook_entries;
CREATE TRIGGER trg_set_org_sacco_cashbook
BEFORE INSERT ON public.sacco_cashbook_entries
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

CREATE OR REPLACE FUNCTION public.touch_sacco_cb_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_sacco_cb_touch ON public.sacco_cashbook_entries;
CREATE TRIGGER trg_sacco_cb_touch
BEFORE UPDATE ON public.sacco_cashbook_entries
FOR EACH ROW EXECUTE FUNCTION public.touch_sacco_cb_updated_at();

-- ---------- sacco_fixed_assets (workspace snapshot, not hotel fixed_assets GL) ----------
CREATE TABLE IF NOT EXISTS public.sacco_fixed_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'In Use',
  current_value numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sacco_fa_org ON public.sacco_fixed_assets (organization_id);

DROP TRIGGER IF EXISTS trg_set_org_sacco_fa ON public.sacco_fixed_assets;
CREATE TRIGGER trg_set_org_sacco_fa
BEFORE INSERT ON public.sacco_fixed_assets
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

CREATE OR REPLACE FUNCTION public.touch_sacco_fa_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_sacco_fa_touch ON public.sacco_fixed_assets;
CREATE TRIGGER trg_sacco_fa_touch
BEFORE UPDATE ON public.sacco_fixed_assets
FOR EACH ROW EXECUTE FUNCTION public.touch_sacco_fa_updated_at();

-- ---------- sacco_provisioning_settings (one row per org) ----------
CREATE TABLE IF NOT EXISTS public.sacco_provisioning_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  provision_choice text NOT NULL DEFAULT 'new' CHECK (provision_choice IN ('old', 'new')),
  general_provision_old numeric NOT NULL DEFAULT 0,
  general_provision_new numeric NOT NULL DEFAULT 0,
  rates jsonb NOT NULL DEFAULT '[]',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- RLS (same pattern as sacco_members) ----------
ALTER TABLE public.sacco_loan_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_fixed_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_cashbook_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_fixed_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_provisioning_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- loan products
  DROP POLICY IF EXISTS "sacco_loan_products_org" ON public.sacco_loan_products;
  CREATE POLICY "sacco_loan_products_org"
    ON public.sacco_loan_products FOR ALL TO authenticated
    USING (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
    WITH CHECK (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

  DROP POLICY IF EXISTS "sacco_loans_org" ON public.sacco_loans;
  CREATE POLICY "sacco_loans_org"
    ON public.sacco_loans FOR ALL TO authenticated
    USING (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
    WITH CHECK (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

  DROP POLICY IF EXISTS "sacco_fd_org" ON public.sacco_fixed_deposits;
  CREATE POLICY "sacco_fd_org"
    ON public.sacco_fixed_deposits FOR ALL TO authenticated
    USING (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
    WITH CHECK (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

  DROP POLICY IF EXISTS "sacco_cb_org" ON public.sacco_cashbook_entries;
  CREATE POLICY "sacco_cb_org"
    ON public.sacco_cashbook_entries FOR ALL TO authenticated
    USING (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
    WITH CHECK (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

  DROP POLICY IF EXISTS "sacco_fa_org" ON public.sacco_fixed_assets;
  CREATE POLICY "sacco_fa_org"
    ON public.sacco_fixed_assets FOR ALL TO authenticated
    USING (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
    WITH CHECK (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

  DROP POLICY IF EXISTS "sacco_prov_org" ON public.sacco_provisioning_settings;
  CREATE POLICY "sacco_prov_org"
    ON public.sacco_provisioning_settings FOR ALL TO authenticated
    USING (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
    WITH CHECK (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sacco_loan_products TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sacco_loans TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sacco_fixed_deposits TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sacco_cashbook_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sacco_fixed_assets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sacco_provisioning_settings TO authenticated;

GRANT ALL ON public.sacco_loan_products TO service_role;
GRANT ALL ON public.sacco_loans TO service_role;
GRANT ALL ON public.sacco_fixed_deposits TO service_role;
GRANT ALL ON public.sacco_cashbook_entries TO service_role;
GRANT ALL ON public.sacco_fixed_assets TO service_role;
GRANT ALL ON public.sacco_provisioning_settings TO service_role;

COMMENT ON TABLE public.sacco_loans IS 'SACCO loan applications and portfolio; disbursement_date set when status becomes disbursed.';
COMMENT ON TABLE public.sacco_loan_products IS 'Configurable loan products per organization.';
