-- Agent Hub core persistence (customers, transactions, float dashboard).

CREATE TABLE IF NOT EXISTS public.agent_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Customer',
  phone text NOT NULL,
  network text NOT NULL DEFAULT 'MTN' CHECK (network IN ('MTN', 'Airtel', 'Bank', 'SACCO')),
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, phone)
);

CREATE TABLE IF NOT EXISTS public.agent_transactions (
  id text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  tx_type text NOT NULL CHECK (tx_type IN ('deposit', 'withdraw', 'send', 'airtime', 'bill')),
  customer_phone text NOT NULL,
  customer_name text,
  amount numeric(15,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  charges numeric(15,2) NOT NULL DEFAULT 0 CHECK (charges >= 0),
  commission numeric(15,2) NOT NULL DEFAULT 0 CHECK (commission >= 0),
  status text NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'pending', 'error')),
  queued_offline boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_float (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  e_float numeric(15,2) NOT NULL DEFAULT 0 CHECK (e_float >= 0),
  cash_balance numeric(15,2) NOT NULL DEFAULT 0 CHECK (cash_balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_customers_org_updated ON public.agent_customers(organization_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_transactions_org_created ON public.agent_transactions(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_transactions_staff_created ON public.agent_transactions(agent_staff_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.touch_agent_customers_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_customers_touch_updated ON public.agent_customers;
CREATE TRIGGER trg_agent_customers_touch_updated
BEFORE UPDATE ON public.agent_customers
FOR EACH ROW
EXECUTE FUNCTION public.touch_agent_customers_updated_at();

CREATE OR REPLACE FUNCTION public.touch_agent_float_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_float_touch_updated ON public.agent_float;
CREATE TRIGGER trg_agent_float_touch_updated
BEFORE UPDATE ON public.agent_float
FOR EACH ROW
EXECUTE FUNCTION public.touch_agent_float_updated_at();

DROP TRIGGER IF EXISTS trg_set_org_agent_customers ON public.agent_customers;
CREATE TRIGGER trg_set_org_agent_customers
BEFORE INSERT ON public.agent_customers
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_agent_transactions ON public.agent_transactions;
CREATE TRIGGER trg_set_org_agent_transactions
BEFORE INSERT ON public.agent_transactions
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_agent_float ON public.agent_float;
CREATE TRIGGER trg_set_org_agent_float
BEFORE INSERT ON public.agent_float
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

ALTER TABLE public.agent_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_float ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_customers_select_same_org" ON public.agent_customers;
DROP POLICY IF EXISTS "agent_customers_write_same_org" ON public.agent_customers;
DROP POLICY IF EXISTS "agent_transactions_select_same_org" ON public.agent_transactions;
DROP POLICY IF EXISTS "agent_transactions_write_same_org" ON public.agent_transactions;
DROP POLICY IF EXISTS "agent_float_select_same_org" ON public.agent_float;
DROP POLICY IF EXISTS "agent_float_write_same_org" ON public.agent_float;

CREATE POLICY "agent_customers_select_same_org"
  ON public.agent_customers FOR SELECT TO authenticated
  USING (
    organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
  );

CREATE POLICY "agent_customers_write_same_org"
  ON public.agent_customers FOR ALL TO authenticated
  USING (
    organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
  )
  WITH CHECK (
    organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
  );

CREATE POLICY "agent_transactions_select_same_org"
  ON public.agent_transactions FOR SELECT TO authenticated
  USING (
    organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
  );

CREATE POLICY "agent_transactions_write_same_org"
  ON public.agent_transactions FOR ALL TO authenticated
  USING (
    organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
  )
  WITH CHECK (
    organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
  );

CREATE POLICY "agent_float_select_same_org"
  ON public.agent_float FOR SELECT TO authenticated
  USING (
    organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
  );

CREATE POLICY "agent_float_write_same_org"
  ON public.agent_float FOR ALL TO authenticated
  USING (
    organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
  )
  WITH CHECK (
    organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
  );

COMMENT ON TABLE public.agent_customers IS 'Saved mobile-money customers for fast repeat transactions in Agent Hub.';
COMMENT ON TABLE public.agent_transactions IS 'Agent Hub transaction ledger with charges and commission snapshots.';
COMMENT ON TABLE public.agent_float IS 'Per-organization float snapshot (e-float and cash balance).';
