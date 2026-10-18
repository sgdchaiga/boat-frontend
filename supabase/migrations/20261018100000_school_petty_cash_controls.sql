-- Dedicated petty-cash controls for schools.  The vouchers remain linked to the
-- main general ledger; this subledger supplies custody, approval and count trails.

CREATE TABLE IF NOT EXISTS public.school_petty_cash_funds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  cash_gl_account_id uuid NOT NULL REFERENCES public.gl_accounts(id) ON DELETE RESTRICT,
  replenishment_source_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  custodian_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  float_limit numeric(18,2) NOT NULL DEFAULT 0 CHECK (float_limit >= 0),
  replenishment_threshold numeric(18,2) NOT NULL DEFAULT 0 CHECK (replenishment_threshold >= 0),
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name),
  UNIQUE (organization_id, cash_gl_account_id)
);

CREATE TABLE IF NOT EXISTS public.school_petty_cash_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  fund_id uuid NOT NULL REFERENCES public.school_petty_cash_funds(id) ON DELETE RESTRICT,
  voucher_number text NOT NULL,
  voucher_date date NOT NULL DEFAULT current_date,
  voucher_type text NOT NULL CHECK (voucher_type IN ('expense','replenishment','adjustment')),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft','submitted','approved','rejected','posted','reversed')),
  payee text,
  narration text NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  expense_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE RESTRICT,
  offset_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE RESTRICT,
  vote_id uuid REFERENCES public.school_budget_votes(id) ON DELETE SET NULL,
  subvote_id uuid REFERENCES public.school_budget_subvotes(id) ON DELETE SET NULL,
  receipt_reference text,
  source_documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  submitted_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  approved_at timestamptz,
  rejection_reason text,
  posted_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  posted_at timestamptz,
  journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  reversed_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  reversed_at timestamptz,
  reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, voucher_number),
  CHECK (
    (voucher_type = 'expense' AND expense_gl_account_id IS NOT NULL)
    OR (voucher_type IN ('replenishment','adjustment') AND offset_gl_account_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.school_petty_cash_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  fund_id uuid NOT NULL REFERENCES public.school_petty_cash_funds(id) ON DELETE RESTRICT,
  count_date date NOT NULL DEFAULT current_date,
  expected_amount numeric(18,2) NOT NULL,
  counted_amount numeric(18,2) NOT NULL CHECK (counted_amount >= 0),
  variance_amount numeric(18,2) NOT NULL,
  notes text,
  counted_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_school_petty_cash_funds_org_active
  ON public.school_petty_cash_funds (organization_id, is_active);
CREATE INDEX IF NOT EXISTS idx_school_petty_cash_vouchers_fund_date
  ON public.school_petty_cash_vouchers (fund_id, voucher_date DESC);
CREATE INDEX IF NOT EXISTS idx_school_petty_cash_vouchers_org_status
  ON public.school_petty_cash_vouchers (organization_id, status, voucher_date DESC);
CREATE INDEX IF NOT EXISTS idx_school_petty_cash_counts_fund_date
  ON public.school_petty_cash_counts (fund_id, count_date DESC);

CREATE OR REPLACE FUNCTION public.touch_school_petty_cash_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_school_petty_cash_funds_updated_at ON public.school_petty_cash_funds;
CREATE TRIGGER trg_school_petty_cash_funds_updated_at BEFORE UPDATE ON public.school_petty_cash_funds
FOR EACH ROW EXECUTE FUNCTION public.touch_school_petty_cash_updated_at();
DROP TRIGGER IF EXISTS trg_school_petty_cash_vouchers_updated_at ON public.school_petty_cash_vouchers;
CREATE TRIGGER trg_school_petty_cash_vouchers_updated_at BEFORE UPDATE ON public.school_petty_cash_vouchers
FOR EACH ROW EXECUTE FUNCTION public.touch_school_petty_cash_updated_at();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['school_petty_cash_funds','school_petty_cash_vouchers','school_petty_cash_counts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS school_petty_cash_org_%I ON public.%I', t, t);
    EXECUTE format('CREATE POLICY school_petty_cash_org_%I ON public.%I FOR ALL TO authenticated USING (public.school_finance_org_member(organization_id)) WITH CHECK (public.school_finance_org_member(organization_id))', t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;

COMMENT ON TABLE public.school_petty_cash_funds IS 'School petty-cash floats, GL accounts and assigned custodians.';
COMMENT ON TABLE public.school_petty_cash_vouchers IS 'Auditable petty-cash expenses, replenishments and approved adjustments.';
COMMENT ON TABLE public.school_petty_cash_counts IS 'Physical counts compared to calculated petty-cash fund balances.';
