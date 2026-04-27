-- Mobile money automation audit trail (Flutterwave MTN/Airtel)

CREATE TABLE IF NOT EXISTS public.mobile_money_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  sale_id uuid,
  tx_ref text NOT NULL UNIQUE,
  flutterwave_tx_id bigint,
  payment_method text,
  network text CHECK (network IN ('mtn', 'airtel')),
  phone_number text NOT NULL,
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'UGX',
  status text NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated', 'pending', 'successful', 'failed', 'timeout', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  paid_at timestamptz,
  last_error text,
  gateway_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mobile_money_attempts_org_created_at
  ON public.mobile_money_attempts (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mobile_money_attempts_sale_id
  ON public.mobile_money_attempts (sale_id);

CREATE INDEX IF NOT EXISTS idx_mobile_money_attempts_status
  ON public.mobile_money_attempts (status);

CREATE OR REPLACE FUNCTION public.touch_mobile_money_attempts_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mobile_money_attempts_touch_updated ON public.mobile_money_attempts;
CREATE TRIGGER trg_mobile_money_attempts_touch_updated
BEFORE UPDATE ON public.mobile_money_attempts
FOR EACH ROW
EXECUTE FUNCTION public.touch_mobile_money_attempts_updated_at();

DROP TRIGGER IF EXISTS trg_set_org_mobile_money_attempts ON public.mobile_money_attempts;
CREATE TRIGGER trg_set_org_mobile_money_attempts
BEFORE INSERT ON public.mobile_money_attempts
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

ALTER TABLE public.mobile_money_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mobile_money_attempts_select_same_org" ON public.mobile_money_attempts;
DROP POLICY IF EXISTS "mobile_money_attempts_write_same_org" ON public.mobile_money_attempts;

CREATE POLICY "mobile_money_attempts_select_same_org"
  ON public.mobile_money_attempts FOR SELECT TO authenticated
  USING (
    organization_id IS NOT NULL
    AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
  );

CREATE POLICY "mobile_money_attempts_write_same_org"
  ON public.mobile_money_attempts FOR ALL TO authenticated
  USING (
    organization_id IS NOT NULL
    AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
  );

COMMENT ON TABLE public.mobile_money_attempts IS
  'Logs MTN/Airtel mobile money collection attempts and gateway responses for reconciliation and troubleshooting.';
