-- Hotel POS journals recognize the sale on the effective completed-payment day.
-- Keep the same JE number while repairing historical date mismatches.
CREATE OR REPLACE FUNCTION public.sync_hotel_pos_journal_payment_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  effective_date date;
BEGIN
  IF NEW.transaction_id IS NULL OR NEW.payment_source IS DISTINCT FROM 'pos_hotel' THEN
    RETURN NEW;
  END IF;

  SELECT (payment.paid_at AT TIME ZONE 'Africa/Kampala')::date
  INTO effective_date
  FROM public.payments AS payment
  WHERE payment.transaction_id = NEW.transaction_id
    AND payment.payment_source = 'pos_hotel'
    AND lower(coalesce(payment.payment_status, '')) = 'completed'
  ORDER BY payment.paid_at DESC
  LIMIT 1;

  IF effective_date IS NOT NULL THEN
    UPDATE public.journal_entries
    SET entry_date = effective_date
    WHERE reference_type = 'pos'
      AND reference_id::text = NEW.transaction_id
      AND is_deleted = false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_hotel_pos_journal_payment_date ON public.payments;
CREATE TRIGGER trg_sync_hotel_pos_journal_payment_date
AFTER INSERT OR UPDATE OF paid_at, payment_status, payment_source, transaction_id ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.sync_hotel_pos_journal_payment_date();

-- An administrator editing a Hotel POS transaction date expects Treasury's
-- linked cash receipt to move to that same effective date.
CREATE OR REPLACE FUNCTION public.sync_hotel_pos_payments_from_order_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    UPDATE public.payments
    SET paid_at = NEW.created_at
    WHERE transaction_id = NEW.id::text
      AND payment_source = 'pos_hotel';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_hotel_pos_payments_from_order_date ON public.kitchen_orders;
CREATE TRIGGER trg_sync_hotel_pos_payments_from_order_date
AFTER UPDATE OF created_at ON public.kitchen_orders
FOR EACH ROW
EXECUTE FUNCTION public.sync_hotel_pos_payments_from_order_date();

WITH latest_completed_payment AS (
  SELECT DISTINCT ON (payment.transaction_id)
    payment.transaction_id AS order_id,
    (payment.paid_at AT TIME ZONE 'Africa/Kampala')::date AS effective_date
  FROM public.payments AS payment
  WHERE payment.transaction_id IS NOT NULL
    AND payment.payment_source = 'pos_hotel'
    AND lower(coalesce(payment.payment_status, '')) = 'completed'
  ORDER BY payment.transaction_id, payment.paid_at DESC
)
UPDATE public.journal_entries AS journal
SET entry_date = payment.effective_date
FROM latest_completed_payment AS payment
WHERE journal.reference_type = 'pos'
  AND journal.reference_id::text = payment.order_id
  AND journal.is_deleted = false
  AND journal.entry_date IS DISTINCT FROM payment.effective_date;
