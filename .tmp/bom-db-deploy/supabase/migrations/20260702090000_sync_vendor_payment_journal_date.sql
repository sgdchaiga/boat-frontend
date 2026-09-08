-- Keep bills/supplier payments and their active accounting journals on the
-- same date, including edits made outside their primary Purchases screens.
CREATE OR REPLACE FUNCTION public.sync_vendor_payment_journal_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.payment_date IS DISTINCT FROM OLD.payment_date THEN
    UPDATE public.journal_entries
    SET entry_date = NEW.payment_date
    WHERE reference_type = 'vendor_payment'
      AND reference_id = NEW.id
      AND is_deleted = false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_vendor_payment_journal_date ON public.vendor_payments;
CREATE TRIGGER trg_sync_vendor_payment_journal_date
AFTER UPDATE OF payment_date ON public.vendor_payments
FOR EACH ROW
EXECUTE FUNCTION public.sync_vendor_payment_journal_date();

CREATE OR REPLACE FUNCTION public.sync_bill_journal_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.bill_date IS DISTINCT FROM OLD.bill_date THEN
    UPDATE public.journal_entries
    SET entry_date = NEW.bill_date
    WHERE reference_type = 'bill'
      AND reference_id = NEW.id
      AND is_deleted = false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_bill_journal_date ON public.bills;
CREATE TRIGGER trg_sync_bill_journal_date
AFTER UPDATE OF bill_date ON public.bills
FOR EACH ROW
EXECUTE FUNCTION public.sync_bill_journal_date();

-- Repair active journals that were left out of sync before this trigger existed.
UPDATE public.journal_entries AS journal
SET entry_date = payment.payment_date
FROM public.vendor_payments AS payment
WHERE journal.reference_type = 'vendor_payment'
  AND journal.reference_id = payment.id
  AND journal.is_deleted = false
  AND journal.entry_date IS DISTINCT FROM payment.payment_date;

UPDATE public.journal_entries AS journal
SET entry_date = bill.bill_date
FROM public.bills AS bill
WHERE journal.reference_type = 'bill'
  AND journal.reference_id = bill.id
  AND journal.is_deleted = false
  AND journal.entry_date IS DISTINCT FROM bill.bill_date;
