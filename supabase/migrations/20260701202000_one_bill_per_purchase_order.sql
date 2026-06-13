-- A purchase order may create only one GRN/bill across every organization type.

CREATE OR REPLACE FUNCTION public.prevent_duplicate_bill_for_purchase_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.purchase_order_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Serialize conversions of the same PO so concurrent clicks cannot create duplicates.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.purchase_order_id::text, 0));

  IF EXISTS (
    SELECT 1
    FROM public.bills b
    WHERE b.purchase_order_id = NEW.purchase_order_id
      AND b.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'This purchase order has already been sent to GRN/Bills.'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_one_bill_per_purchase_order ON public.bills;
CREATE TRIGGER trg_one_bill_per_purchase_order
BEFORE INSERT OR UPDATE OF purchase_order_id ON public.bills
FOR EACH ROW
EXECUTE FUNCTION public.prevent_duplicate_bill_for_purchase_order();

COMMENT ON FUNCTION public.prevent_duplicate_bill_for_purchase_order() IS
  'Prevents a purchase order from creating more than one GRN/bill, including concurrent conversions.';
