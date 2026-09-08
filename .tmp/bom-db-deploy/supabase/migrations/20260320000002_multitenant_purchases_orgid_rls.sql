-- Multi-tenant isolation for Purchases:
-- Add `organization_id` to purchasing tables, backfill where possible from journal_entries,
-- set it automatically via triggers, and enforce org-scoped RLS.

-- 1) Columns
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.vendor_payments ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.vendor_credits ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

-- 2) Backfill using accounting journals (best-effort)
-- bills
UPDATE public.bills b
SET organization_id = je.organization_id
FROM public.journal_entries je
WHERE je.reference_type = 'bill'
  AND je.reference_id = b.id
  AND b.organization_id IS NULL
  AND je.organization_id IS NOT NULL;

-- vendor_payments
UPDATE public.vendor_payments vp
SET organization_id = je.organization_id
FROM public.journal_entries je
WHERE je.reference_type = 'vendor_payment'
  AND je.reference_id = vp.id
  AND vp.organization_id IS NULL
  AND je.organization_id IS NOT NULL;

-- expenses
UPDATE public.expenses e
SET organization_id = je.organization_id
FROM public.journal_entries je
WHERE je.reference_type = 'expense'
  AND je.reference_id = e.id
  AND e.organization_id IS NULL
  AND je.organization_id IS NOT NULL;

-- purchase_orders and purchase_order_items via bills
UPDATE public.purchase_orders po
SET organization_id = sub.organization_id
FROM (
  SELECT
    po.id AS purchase_order_id,
    (ARRAY_AGG(b.organization_id ORDER BY b.created_at DESC NULLS LAST))[1] AS organization_id
  FROM public.purchase_orders po
  JOIN public.bills b ON b.purchase_order_id = po.id
  WHERE b.organization_id IS NOT NULL
  GROUP BY po.id
) sub
WHERE po.id = sub.purchase_order_id
  AND po.organization_id IS NULL
  AND sub.organization_id IS NOT NULL;

UPDATE public.purchase_order_items poi
SET organization_id = po.organization_id
FROM public.purchase_orders po
WHERE poi.purchase_order_id = po.id
  AND poi.organization_id IS NULL
  AND po.organization_id IS NOT NULL;

-- vendors via any related bill/expense/vendor_payment
UPDATE public.vendors v
SET organization_id = sub.organization_id
FROM (
  SELECT
    v.id AS vendor_id,
    COALESCE(
      (ARRAY_AGG(b.organization_id ORDER BY b.created_at DESC NULLS LAST))[1],
      (ARRAY_AGG(vp.organization_id ORDER BY vp.created_at DESC NULLS LAST))[1]
    ) AS organization_id
  FROM public.vendors v
  LEFT JOIN public.bills b ON b.vendor_id = v.id AND b.organization_id IS NOT NULL
  LEFT JOIN public.vendor_payments vp ON vp.vendor_id = v.id AND vp.organization_id IS NOT NULL
  GROUP BY v.id
) sub
WHERE v.id = sub.vendor_id
  AND v.organization_id IS NULL
  AND sub.organization_id IS NOT NULL;

-- vendor_credits via vendors
UPDATE public.vendor_credits vc
SET organization_id = v.organization_id
FROM public.vendors v
WHERE vc.vendor_id = v.id
  AND vc.organization_id IS NULL
  AND v.organization_id IS NOT NULL;

-- 3) Triggers: set org_id from auth staff row
CREATE OR REPLACE FUNCTION public.set_org_id_from_auth_staff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    SELECT s.organization_id INTO NEW.organization_id
    FROM public.staff s
    WHERE s.id = auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_org_vendors ON public.vendors;
CREATE TRIGGER trg_set_org_vendors
BEFORE INSERT ON public.vendors
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_expenses ON public.expenses;
CREATE TRIGGER trg_set_org_expenses
BEFORE INSERT ON public.expenses
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_purchase_orders ON public.purchase_orders;
CREATE TRIGGER trg_set_org_purchase_orders
BEFORE INSERT ON public.purchase_orders
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_bills ON public.bills;
CREATE TRIGGER trg_set_org_bills
BEFORE INSERT ON public.bills
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_vendor_payments ON public.vendor_payments;
CREATE TRIGGER trg_set_org_vendor_payments
BEFORE INSERT ON public.vendor_payments
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_vendor_credits ON public.vendor_credits;
CREATE TRIGGER trg_set_org_vendor_credits
BEFORE INSERT ON public.vendor_credits
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_purchase_order_items ON public.purchase_order_items;
CREATE TRIGGER trg_set_org_purchase_order_items
BEFORE INSERT ON public.purchase_order_items
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

-- 4) RLS policies
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;

-- Drop old permissive policies created by earlier migrations (best-effort by known names)
DROP POLICY IF EXISTS "Allow all for vendors" ON public.vendors;
DROP POLICY IF EXISTS "Allow all for expenses" ON public.expenses;
DROP POLICY IF EXISTS "Allow all for purchase_orders" ON public.purchase_orders;
DROP POLICY IF EXISTS "Allow all for bills" ON public.bills;
DROP POLICY IF EXISTS "Allow all for vendor_payments" ON public.vendor_payments;
DROP POLICY IF EXISTS "Allow all for vendor_credits" ON public.vendor_credits;
DROP POLICY IF EXISTS "Allow all for purchase_order_items" ON public.purchase_order_items;

CREATE POLICY "vendors_select_same_org"
  ON public.vendors FOR SELECT TO authenticated
  USING (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

CREATE POLICY "vendors_write_same_org"
  ON public.vendors FOR ALL TO authenticated
  USING (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

CREATE POLICY "expenses_select_same_org"
  ON public.expenses FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

CREATE POLICY "expenses_write_same_org"
  ON public.expenses FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
  WITH CHECK (organization_id IS NOT NULL AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

CREATE POLICY "purchase_orders_select_same_org"
  ON public.purchase_orders FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

CREATE POLICY "purchase_orders_write_same_org"
  ON public.purchase_orders FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
  WITH CHECK (organization_id IS NOT NULL AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

CREATE POLICY "bills_select_same_org"
  ON public.bills FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

CREATE POLICY "bills_write_same_org"
  ON public.bills FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
  WITH CHECK (organization_id IS NOT NULL AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

CREATE POLICY "vendor_payments_select_same_org"
  ON public.vendor_payments FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

CREATE POLICY "vendor_payments_write_same_org"
  ON public.vendor_payments FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
  WITH CHECK (organization_id IS NOT NULL AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

CREATE POLICY "vendor_credits_select_same_org"
  ON public.vendor_credits FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

CREATE POLICY "vendor_credits_write_same_org"
  ON public.vendor_credits FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
  WITH CHECK (organization_id IS NOT NULL AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

CREATE POLICY "purchase_order_items_select_same_org"
  ON public.purchase_order_items FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

CREATE POLICY "purchase_order_items_write_same_org"
  ON public.purchase_order_items FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
  WITH CHECK (organization_id IS NOT NULL AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

