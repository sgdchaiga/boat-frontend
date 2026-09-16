-- Client-issued references remain separate from the system UUID-based identifiers.
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS lpo_number text;

ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS invoice_number text;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_organization_lpo_number
  ON public.purchase_orders (organization_id, lpo_number)
  WHERE lpo_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bills_organization_invoice_number
  ON public.bills (organization_id, invoice_number)
  WHERE invoice_number IS NOT NULL;

COMMENT ON COLUMN public.purchase_orders.lpo_number IS
  'Client/manual Local Purchase Order (LPO) reference; separate from the system-generated PO ID.';
COMMENT ON COLUMN public.bills.invoice_number IS
  'Supplier/client manual invoice reference used to identify the GRN/bill and related payments.';
