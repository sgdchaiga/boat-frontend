-- Per-tenant purchase workflow: optional PO approval before GRN, optional GRN/bill approval after convert.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS purchases_require_po_approval boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS purchases_require_bill_approval boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.organizations.purchases_require_po_approval IS
  'When true, a purchase order must be approved before it can be converted to a GRN/bill.';
COMMENT ON COLUMN public.organizations.purchases_require_bill_approval IS
  'When true, a GRN/bill created from a purchase order requires approval (stock-in runs on approval). When false, convert finalizes the bill immediately.';

-- Staff org admins may update only these flags (RLS otherwise limits organizations to platform admins).
CREATE OR REPLACE FUNCTION public.update_organization_purchase_workflow(
  p_require_po_approval boolean,
  p_require_bill_approval boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  oid uuid;
  r text;
BEGIN
  SELECT s.organization_id, s.role INTO oid, r
  FROM public.staff s
  WHERE s.id = (SELECT auth.uid())
  LIMIT 1;

  IF oid IS NULL THEN
    RAISE EXCEPTION 'No staff profile for current user';
  END IF;

  IF r IS NULL OR r NOT IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'Only organization administrators can change purchase workflow settings';
  END IF;

  UPDATE public.organizations
  SET
    purchases_require_po_approval = p_require_po_approval,
    purchases_require_bill_approval = p_require_bill_approval,
    updated_at = now()
  WHERE id = oid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_organization_purchase_workflow(boolean, boolean) TO authenticated;
