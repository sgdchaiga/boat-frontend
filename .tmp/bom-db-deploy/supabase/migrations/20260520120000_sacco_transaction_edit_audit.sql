-- SACCO: authorized officers may correct teller transactions with immutable audit trail.

ALTER TABLE public.sacco_teller_transactions
  ADD COLUMN IF NOT EXISTS corrects_txn_id uuid REFERENCES public.sacco_teller_transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS correction_reason text;

CREATE INDEX IF NOT EXISTS idx_sacco_teller_txn_corrects
  ON public.sacco_teller_transactions (corrects_txn_id)
  WHERE corrects_txn_id IS NOT NULL;

ALTER TABLE public.sacco_teller_transactions
  DROP CONSTRAINT IF EXISTS sacco_teller_transactions_status_check;

ALTER TABLE public.sacco_teller_transactions
  ADD CONSTRAINT sacco_teller_transactions_status_check
  CHECK (status IN ('draft', 'pending_approval', 'posted', 'rejected', 'cancelled', 'reversed'));

COMMENT ON COLUMN public.sacco_teller_transactions.corrects_txn_id IS
  'When set, this row is the replacement posting for the original transaction.';
COMMENT ON COLUMN public.sacco_teller_transactions.correction_reason IS
  'Mandatory reason when a posted transaction is reversed and corrected.';

-- Structured edit audit (snapshots); teller audit log also receives txn_corrected / txn_edited.
CREATE TABLE IF NOT EXISTS public.sacco_transaction_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  original_txn_id uuid NOT NULL REFERENCES public.sacco_teller_transactions(id) ON DELETE CASCADE,
  replacement_txn_id uuid REFERENCES public.sacco_teller_transactions(id) ON DELETE SET NULL,
  editor_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  edit_kind text NOT NULL CHECK (edit_kind IN ('pending_edit', 'posted_correction')),
  reason text NOT NULL,
  old_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  new_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sacco_txn_edits_org_created
  ON public.sacco_transaction_edits (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sacco_txn_edits_original
  ON public.sacco_transaction_edits (original_txn_id, created_at DESC);

ALTER TABLE public.sacco_transaction_edits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sacco_txn_edits_select" ON public.sacco_transaction_edits;
CREATE POLICY "sacco_txn_edits_select"
  ON public.sacco_transaction_edits FOR SELECT TO authenticated
  USING (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

DROP POLICY IF EXISTS "sacco_txn_edits_insert" ON public.sacco_transaction_edits;
CREATE POLICY "sacco_txn_edits_insert"
  ON public.sacco_transaction_edits FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

GRANT SELECT, INSERT ON public.sacco_transaction_edits TO authenticated;
GRANT ALL ON public.sacco_transaction_edits TO service_role;

-- Permission: sacco_transaction_edit (default admin, manager, accountant).
INSERT INTO public.organization_permissions (organization_id, role_key, permission_key, allowed)
SELECT ort.organization_id, ort.role_key, 'sacco_transaction_edit', ort.role_key IN ('admin', 'manager', 'accountant')
FROM public.organization_role_types ort
ON CONFLICT (organization_id, role_key, permission_key) DO NOTHING;

COMMENT ON TABLE public.sacco_transaction_edits IS
  'Immutable SACCO teller transaction edit/correction audit snapshots.';
