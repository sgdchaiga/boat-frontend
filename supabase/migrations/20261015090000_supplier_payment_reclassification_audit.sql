-- Preserve an explicit audit link when a supplier payment is reclassified.
-- The replacement transaction also retains a [RECLASSIFIED FROM:...] reference.
ALTER TABLE public.vendor_payments
  ADD COLUMN IF NOT EXISTS reclassified_to_type text,
  ADD COLUMN IF NOT EXISTS reclassified_to_id uuid,
  ADD COLUMN IF NOT EXISTS reclassified_at timestamptz,
  ADD COLUMN IF NOT EXISTS reclassified_by uuid REFERENCES public.staff(id) ON DELETE SET NULL;

ALTER TABLE public.vendor_payments
  DROP CONSTRAINT IF EXISTS vendor_payments_reclassified_to_type_check;

ALTER TABLE public.vendor_payments
  ADD CONSTRAINT vendor_payments_reclassified_to_type_check
  CHECK (reclassified_to_type IS NULL OR reclassified_to_type IN ('expense', 'petty_cash'));

CREATE INDEX IF NOT EXISTS vendor_payments_reclassified_to_idx
  ON public.vendor_payments(organization_id, reclassified_to_type, reclassified_at DESC)
  WHERE reclassified_to_type IS NOT NULL;

COMMENT ON COLUMN public.vendor_payments.reclassified_to_id IS
  'ID of the replacement expenses or general_business_cashbook_entries record.';
