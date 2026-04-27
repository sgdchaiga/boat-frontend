-- Track reminder activity for retail credit collections.

CREATE TABLE IF NOT EXISTS public.retail_credit_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES public.retail_sales(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.retail_customers(id) ON DELETE SET NULL,
  customer_name text,
  customer_phone text,
  amount_due numeric(15,2) NOT NULL DEFAULT 0 CHECK (amount_due >= 0),
  due_date date,
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'manual_copy')),
  message text NOT NULL,
  reminded_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  reminded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_retail_credit_reminders_org_time
  ON public.retail_credit_reminders(organization_id, reminded_at DESC);
CREATE INDEX IF NOT EXISTS idx_retail_credit_reminders_sale
  ON public.retail_credit_reminders(sale_id, reminded_at DESC);

DROP TRIGGER IF EXISTS trg_set_org_retail_credit_reminders ON public.retail_credit_reminders;
CREATE TRIGGER trg_set_org_retail_credit_reminders
BEFORE INSERT ON public.retail_credit_reminders
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

ALTER TABLE public.retail_credit_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "retail_credit_reminders_select_same_org" ON public.retail_credit_reminders;
DROP POLICY IF EXISTS "retail_credit_reminders_write_same_org" ON public.retail_credit_reminders;

CREATE POLICY "retail_credit_reminders_select_same_org"
  ON public.retail_credit_reminders FOR SELECT TO authenticated
  USING (
    organization_id IS NOT NULL
    AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
  );

CREATE POLICY "retail_credit_reminders_write_same_org"
  ON public.retail_credit_reminders FOR ALL TO authenticated
  USING (
    organization_id IS NOT NULL
    AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
  );

COMMENT ON TABLE public.retail_credit_reminders IS
  'Audit log of reminders sent for outstanding retail credit balances.';
