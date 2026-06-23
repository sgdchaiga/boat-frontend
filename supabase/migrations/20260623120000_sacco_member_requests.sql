CREATE TABLE IF NOT EXISTS public.sacco_member_requests (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sacco_member_id uuid NOT NULL REFERENCES public.sacco_members(id) ON DELETE CASCADE,
  request_type text NOT NULL CHECK (request_type IN ('savings_deposit', 'member_transfer', 'bill_payment')),
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  destination text,
  provider text,
  account_reference text,
  note text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'rejected')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processed_by uuid REFERENCES public.staff(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_sacco_member_requests_org_status
  ON public.sacco_member_requests(organization_id, status, requested_at DESC);

ALTER TABLE public.sacco_member_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sacco_member_requests_same_org" ON public.sacco_member_requests;
CREATE POLICY "sacco_member_requests_same_org"
  ON public.sacco_member_requests FOR ALL TO authenticated
  USING (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
  WITH CHECK (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

COMMENT ON TABLE public.sacco_member_requests IS
  'Idempotent member-app instructions queued offline; staff or a payment integration confirms and posts them.';
