-- Multi-bill payment split on one vendor_payment row (no extra table required).
-- Format: [{"bill_id":"<uuid>","amount":123.45}, ...]

ALTER TABLE public.vendor_payments ADD COLUMN IF NOT EXISTS bill_allocations jsonb;

COMMENT ON COLUMN public.vendor_payments.bill_allocations IS 'Optional split across bills: [{"bill_id":"uuid","amount":n}, ...]. Mutually exclusive with bill_id for new rows.';
