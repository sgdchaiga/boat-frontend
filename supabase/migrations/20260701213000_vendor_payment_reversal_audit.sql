ALTER TABLE public.vendor_payments
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversal_reason text;

UPDATE public.vendor_payments SET status = 'active' WHERE status IS NULL;

ALTER TABLE public.vendor_payments DROP CONSTRAINT IF EXISTS vendor_payments_status_check;
ALTER TABLE public.vendor_payments
  ADD CONSTRAINT vendor_payments_status_check CHECK (status IN ('active', 'reversed'));

CREATE INDEX IF NOT EXISTS idx_vendor_payments_org_status
  ON public.vendor_payments (organization_id, status, payment_date DESC);
