-- Prevent a configured maker-checker route from being bypassed by an older
-- direct-approval screen or a direct client-side table update.

DROP POLICY IF EXISTS school_finance_org_school_approval_requests ON public.school_approval_requests;
CREATE POLICY school_approval_requests_read ON public.school_approval_requests
  FOR SELECT TO authenticated
  USING (public.school_finance_org_member(organization_id));

CREATE OR REPLACE FUNCTION public.school_guard_routed_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (
    (NEW.status IN ('approved', 'rejected') AND OLD.status IS DISTINCT FROM NEW.status)
    OR (TG_TABLE_NAME = 'bills' AND NEW.approved_at IS NOT NULL AND OLD.approved_at IS NULL)
  ) AND EXISTS (
    SELECT 1
    FROM public.school_approval_requests r
    WHERE r.source_id = NEW.id
      AND r.transaction_type = CASE WHEN TG_TABLE_NAME = 'purchase_orders' THEN 'purchase_order' ELSE 'supplier_bill' END
      AND r.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'This document is in a configured approval workflow. Decide it through the approval matrix.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_school_guard_purchase_order_approval ON public.purchase_orders;
CREATE TRIGGER trg_school_guard_purchase_order_approval
  BEFORE UPDATE OF status, approved_at ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.school_guard_routed_approval();

DROP TRIGGER IF EXISTS trg_school_guard_bill_approval ON public.bills;
CREATE TRIGGER trg_school_guard_bill_approval
  BEFORE UPDATE OF status, approved_at ON public.bills
  FOR EACH ROW EXECUTE FUNCTION public.school_guard_routed_approval();
