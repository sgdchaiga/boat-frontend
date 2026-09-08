-- Enforce SACCO maker-checker separation at the database boundary.
-- Rollback: drop trigger trg_sacco_teller_prevent_self_approval and function
-- public.prevent_sacco_teller_self_approval(). Existing data is not modified.

CREATE OR REPLACE FUNCTION public.prevent_sacco_teller_self_approval()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'posted'
     AND OLD.status = 'pending_approval'
     AND NEW.maker_staff_id IS NOT NULL
     AND NEW.checker_staff_id = NEW.maker_staff_id THEN
    RAISE EXCEPTION 'A transaction maker cannot approve their own transaction';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sacco_teller_prevent_self_approval
  ON public.sacco_teller_transactions;

CREATE TRIGGER trg_sacco_teller_prevent_self_approval
BEFORE UPDATE ON public.sacco_teller_transactions
FOR EACH ROW
EXECUTE FUNCTION public.prevent_sacco_teller_self_approval();

