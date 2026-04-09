-- Customer-linked incoming payments + optional stay + split across retail_invoices (like vendor payment allocations).

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS property_customer_id uuid REFERENCES public.hotel_customers(id) ON DELETE SET NULL;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS retail_customer_id uuid REFERENCES public.retail_customers(id) ON DELETE SET NULL;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS invoice_allocations jsonb;

COMMENT ON COLUMN public.payments.property_customer_id IS
  'Hotel/property customer (hotel_customers) when payment is not stay-only.';

COMMENT ON COLUMN public.payments.retail_customer_id IS
  'Retail CRM customer (retail_customers) for retail-originated receipts.';

COMMENT ON COLUMN public.payments.invoice_allocations IS
  'Optional split across retail_invoices: [{"invoice_id":"uuid","amount":n}, ...]. Sum of amounts should not exceed payment amount.';

CREATE INDEX IF NOT EXISTS idx_payments_property_customer ON public.payments (property_customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_retail_customer ON public.payments (retail_customer_id);

NOTIFY pgrst, 'reload schema';
