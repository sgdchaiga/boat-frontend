-- Rename hotel/property guest profiles: public.guests -> public.customers
-- (Distinct from public.retail_customers, which is retail CRM.)
-- FK columns still named guest_id at this step; migration 20260401000000 renames them to property_customer_id.

ALTER TABLE IF EXISTS public.guests RENAME TO customers;

COMMENT ON TABLE public.customers IS
  'Property customers (hotel/mixed): guest profiles for stays, reservations, invoicing. Not the same as retail_customers.';

COMMENT ON COLUMN public.retail_invoices.guest_id IS
  'Links invoice to customers.id; renamed to property_customer_id in 20260401000000. retail_invoices.customer_id references retail_customers.';

NOTIFY pgrst, 'reload schema';
