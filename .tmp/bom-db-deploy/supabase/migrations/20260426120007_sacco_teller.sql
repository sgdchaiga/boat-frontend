-- Teller: till sessions, transactions (cash/cheque), vault movements, audit trail.
-- GL posting: client sets journal_batch_ref when journals are created.

CREATE TABLE IF NOT EXISTS public.sacco_teller_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  opening_float numeric NOT NULL DEFAULT 0 CHECK (opening_float >= 0),
  closing_counted numeric,
  expected_balance numeric,
  over_short numeric,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sacco_teller_sess_one_open_per_staff
  ON public.sacco_teller_sessions (organization_id, staff_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_sacco_teller_sess_org ON public.sacco_teller_sessions (organization_id);
CREATE INDEX IF NOT EXISTS idx_sacco_teller_sess_staff ON public.sacco_teller_sessions (staff_id);

CREATE TABLE IF NOT EXISTS public.sacco_teller_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.sacco_teller_sessions(id) ON DELETE SET NULL,
  txn_type text NOT NULL CHECK (txn_type IN (
    'cash_deposit', 'cash_withdrawal', 'cheque_received', 'cheque_paid', 'cheque_clearing', 'adjustment'
  )),
  amount numeric NOT NULL CHECK (amount >= 0),
  sacco_member_id uuid REFERENCES public.sacco_members(id) ON DELETE SET NULL,
  member_ref text,
  narration text,
  cheque_number text,
  cheque_bank text,
  cheque_value_date date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'pending_approval', 'posted', 'rejected', 'cancelled'
  )),
  maker_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  checker_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  approved_at timestamptz,
  journal_batch_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sacco_teller_txn_org ON public.sacco_teller_transactions (organization_id);
CREATE INDEX IF NOT EXISTS idx_sacco_teller_txn_session ON public.sacco_teller_transactions (session_id);
CREATE INDEX IF NOT EXISTS idx_sacco_teller_txn_created ON public.sacco_teller_transactions (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sacco_teller_txn_pending
  ON public.sacco_teller_transactions (organization_id)
  WHERE status = 'pending_approval';

CREATE TABLE IF NOT EXISTS public.sacco_vault_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.sacco_teller_sessions(id) ON DELETE SET NULL,
  signed_vault_change numeric NOT NULL,
  narration text,
  reference_code text,
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sacco_vault_mov_org ON public.sacco_vault_movements (organization_id);
CREATE INDEX IF NOT EXISTS idx_sacco_vault_mov_created ON public.sacco_vault_movements (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.sacco_teller_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  actor_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sacco_teller_audit_org ON public.sacco_teller_audit_log (organization_id, created_at DESC);

-- Touch triggers
CREATE OR REPLACE FUNCTION public.touch_sacco_teller_sessions_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_sacco_teller_sess_touch ON public.sacco_teller_sessions;
CREATE TRIGGER trg_sacco_teller_sess_touch
BEFORE UPDATE ON public.sacco_teller_sessions
FOR EACH ROW EXECUTE FUNCTION public.touch_sacco_teller_sessions_updated_at();

CREATE OR REPLACE FUNCTION public.touch_sacco_teller_txn_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_sacco_teller_txn_touch ON public.sacco_teller_transactions;
CREATE TRIGGER trg_sacco_teller_txn_touch
BEFORE UPDATE ON public.sacco_teller_transactions
FOR EACH ROW EXECUTE FUNCTION public.touch_sacco_teller_txn_updated_at();

-- RLS
ALTER TABLE public.sacco_teller_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_teller_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_vault_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_teller_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sacco_teller_sess_org" ON public.sacco_teller_sessions;
CREATE POLICY "sacco_teller_sess_org"
  ON public.sacco_teller_sessions FOR ALL TO authenticated
  USING (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
  WITH CHECK (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

DROP POLICY IF EXISTS "sacco_teller_txn_org" ON public.sacco_teller_transactions;
CREATE POLICY "sacco_teller_txn_org"
  ON public.sacco_teller_transactions FOR ALL TO authenticated
  USING (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
  WITH CHECK (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

DROP POLICY IF EXISTS "sacco_vault_mov_org" ON public.sacco_vault_movements;
CREATE POLICY "sacco_vault_mov_org"
  ON public.sacco_vault_movements FOR ALL TO authenticated
  USING (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
  WITH CHECK (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

DROP POLICY IF EXISTS "sacco_teller_audit_select" ON public.sacco_teller_audit_log;
CREATE POLICY "sacco_teller_audit_select"
  ON public.sacco_teller_audit_log FOR SELECT TO authenticated
  USING (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

DROP POLICY IF EXISTS "sacco_teller_audit_insert" ON public.sacco_teller_audit_log;
CREATE POLICY "sacco_teller_audit_insert"
  ON public.sacco_teller_audit_log FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sacco_teller_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sacco_teller_transactions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sacco_vault_movements TO authenticated;
GRANT SELECT, INSERT ON public.sacco_teller_audit_log TO authenticated;
GRANT ALL ON public.sacco_teller_sessions TO service_role;
GRANT ALL ON public.sacco_teller_transactions TO service_role;
GRANT ALL ON public.sacco_vault_movements TO service_role;
GRANT ALL ON public.sacco_teller_audit_log TO service_role;

COMMENT ON TABLE public.sacco_teller_sessions IS 'Per-staff till session; one open session per staff per org.';
COMMENT ON TABLE public.sacco_teller_transactions IS 'Teller cash/cheque transactions; GL via journal_batch_ref.';
COMMENT ON TABLE public.sacco_vault_movements IS 'Vault balance changes; sum(signed_vault_change) gives movement total from baseline zero.';
COMMENT ON TABLE public.sacco_teller_audit_log IS 'Append-only teller audit trail (no UPDATE/DELETE for authenticated).';
