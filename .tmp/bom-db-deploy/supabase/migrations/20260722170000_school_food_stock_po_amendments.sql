-- School food-cover forecasting and auditable PO rejection/amendment.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_food_item boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reorder_lead_days integer NOT NULL DEFAULT 7 CHECK(reorder_lead_days>=0);
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS school_term_end_date date;
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS amendment_number integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amended_from_rejection boolean NOT NULL DEFAULT false;

-- Older databases may constrain PO status to pending/approved.
ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_status_check
CHECK(status IN('pending','approved','rejected','cancelled'));

COMMENT ON COLUMN public.products.is_food_item IS 'Include in school food days-cover analysis.';
COMMENT ON COLUMN public.purchase_orders.rejection_reason IS 'Mandatory reason supplied by the approver when rejecting the PO.';
