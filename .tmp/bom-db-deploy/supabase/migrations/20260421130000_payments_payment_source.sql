-- Explicit receipt line: POS (hotel / retail) vs debtor (AR, folio, manual customer receipts).

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS payment_source text;

COMMENT ON COLUMN public.payments.payment_source IS
  'pos_hotel = Hotel POS pay now; pos_retail = Retail POS cash; debtor = invoices, guest folio, manual receipts, credit-on-account.';

UPDATE public.payments SET payment_source = 'debtor' WHERE payment_source IS NULL;

-- Backfill pos_hotel: transaction_id (base before "[") matches kitchen_orders.id.
UPDATE public.payments p
SET payment_source = 'pos_hotel'
FROM public.kitchen_orders k
WHERE p.payment_source = 'debtor'
  AND p.transaction_id IS NOT NULL
  AND trim(split_part(p.transaction_id::text, '[', 1)) = k.id::text
  AND p.payment_status = 'completed'
  AND p.stay_id IS NULL
  AND p.property_customer_id IS NULL
  AND p.retail_customer_id IS NULL;

-- Remaining POS-shaped rows → retail POS cash.
UPDATE public.payments p
SET payment_source = 'pos_retail'
WHERE p.payment_source = 'debtor'
  AND p.payment_status = 'completed'
  AND p.transaction_id IS NOT NULL
  AND p.stay_id IS NULL
  AND p.property_customer_id IS NULL
  AND p.retail_customer_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.kitchen_orders k
    WHERE trim(split_part(p.transaction_id::text, '[', 1)) = k.id::text
  );

-- Optional: align invoice_allocations-only rows to debtor (already debtor).

ALTER TABLE public.payments
  ALTER COLUMN payment_source SET DEFAULT 'debtor';

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_payment_source_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_payment_source_check
  CHECK (payment_source IN ('pos_hotel', 'pos_retail', 'debtor'));

ALTER TABLE public.payments
  ALTER COLUMN payment_source SET NOT NULL;

NOTIFY pgrst, 'reload schema';
