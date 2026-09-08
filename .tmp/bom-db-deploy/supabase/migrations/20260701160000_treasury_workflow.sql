-- Shared Treasury approval and disbursement queue.

CREATE TABLE IF NOT EXISTS public.treasury_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('expense', 'bill')),
  source_id uuid NOT NULL,
  request_type text NOT NULL CHECK (request_type IN ('expense', 'supplier_payment')),
  payee_name text,
  purpose text NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('pending_approval', 'approved', 'rejected', 'disbursed')),
  requested_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  approved_at timestamptz,
  rejected_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  rejected_at timestamptz,
  rejection_reason text,
  disbursed_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  disbursed_at timestamptz,
  payment_method text,
  payment_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_treasury_requests_org_status
  ON public.treasury_requests(organization_id, status, requested_at DESC);

DROP TRIGGER IF EXISTS trg_set_org_treasury_requests ON public.treasury_requests;
CREATE TRIGGER trg_set_org_treasury_requests
BEFORE INSERT ON public.treasury_requests
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

CREATE OR REPLACE FUNCTION public.touch_treasury_requests_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_treasury_requests_touch_updated ON public.treasury_requests;
CREATE TRIGGER trg_treasury_requests_touch_updated
BEFORE UPDATE ON public.treasury_requests
FOR EACH ROW
EXECUTE FUNCTION public.touch_treasury_requests_updated_at();

ALTER TABLE public.treasury_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "treasury_requests_select_same_org" ON public.treasury_requests;
DROP POLICY IF EXISTS "treasury_requests_write_same_org" ON public.treasury_requests;

CREATE POLICY "treasury_requests_select_same_org"
  ON public.treasury_requests FOR SELECT
  TO authenticated
  USING (
    organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

CREATE POLICY "treasury_requests_write_same_org"
  ON public.treasury_requests FOR ALL
  TO authenticated
  USING (
    organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

COMMENT ON TABLE public.treasury_requests IS
  'Tenant-scoped approval and fund-disbursement queue sourced from expenses and approved supplier bills.';
