-- Split one vendor payment across multiple bills (bulk payment)

CREATE TABLE IF NOT EXISTS public.vendor_payment_bill_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_payment_id uuid NOT NULL REFERENCES public.vendor_payments(id) ON DELETE CASCADE,
  bill_id uuid NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  created_at timestamptz DEFAULT now(),
  UNIQUE (vendor_payment_id, bill_id)
);

CREATE INDEX IF NOT EXISTS idx_vp_bill_alloc_payment ON public.vendor_payment_bill_allocations(vendor_payment_id);
CREATE INDEX IF NOT EXISTS idx_vp_bill_alloc_bill ON public.vendor_payment_bill_allocations(bill_id);

ALTER TABLE public.vendor_payment_bill_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vp_bill_alloc_select_same_org"
  ON public.vendor_payment_bill_allocations FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vendor_payments vp
      WHERE vp.id = vendor_payment_bill_allocations.vendor_payment_id
        AND vp.organization_id IS NOT NULL
        AND vp.organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
    )
  );

CREATE POLICY "vp_bill_alloc_write_same_org"
  ON public.vendor_payment_bill_allocations FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vendor_payments vp
      WHERE vp.id = vendor_payment_bill_allocations.vendor_payment_id
        AND vp.organization_id IS NOT NULL
        AND vp.organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.vendor_payments vp
      WHERE vp.id = vendor_payment_bill_allocations.vendor_payment_id
        AND vp.organization_id IS NOT NULL
        AND vp.organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
    )
  );
