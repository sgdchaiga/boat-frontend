-- Retail POS cashier sessions, till open/close, and variance capture.

CREATE TABLE IF NOT EXISTS public.retail_cashier_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opened_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  opening_float numeric(15,2) NOT NULL DEFAULT 0 CHECK (opening_float >= 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  closed_at timestamptz,
  closing_cash_counted numeric(15,2),
  expected_cash numeric(15,2),
  variance_amount numeric(15,2),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.retail_sales
  ADD COLUMN IF NOT EXISTS cashier_session_id uuid REFERENCES public.retail_cashier_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_retail_cashier_sessions_org_opened ON public.retail_cashier_sessions(organization_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_retail_sales_cashier_session ON public.retail_sales(cashier_session_id);

CREATE OR REPLACE FUNCTION public.touch_retail_cashier_sessions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_retail_cashier_sessions_touch_updated ON public.retail_cashier_sessions;
CREATE TRIGGER trg_retail_cashier_sessions_touch_updated
BEFORE UPDATE ON public.retail_cashier_sessions
FOR EACH ROW
EXECUTE FUNCTION public.touch_retail_cashier_sessions_updated_at();

DROP TRIGGER IF EXISTS trg_set_org_retail_cashier_sessions ON public.retail_cashier_sessions;
CREATE TRIGGER trg_set_org_retail_cashier_sessions
BEFORE INSERT ON public.retail_cashier_sessions
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

ALTER TABLE public.retail_cashier_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "retail_cashier_sessions_select_same_org" ON public.retail_cashier_sessions;
DROP POLICY IF EXISTS "retail_cashier_sessions_write_same_org" ON public.retail_cashier_sessions;

CREATE POLICY "retail_cashier_sessions_select_same_org"
  ON public.retail_cashier_sessions FOR SELECT TO authenticated
  USING (
    organization_id IS NOT NULL
    AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
  );

CREATE POLICY "retail_cashier_sessions_write_same_org"
  ON public.retail_cashier_sessions FOR ALL TO authenticated
  USING (
    organization_id IS NOT NULL
    AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
  );

COMMENT ON TABLE public.retail_cashier_sessions IS 'Retail POS cashier shifts: opening float, close count, expected cash, and variance.';
