-- Disambiguate from retail_customers: public.customers -> public.hotel_customers
-- FK columns (property_customer_id) continue to reference this table by id.

ALTER TABLE IF EXISTS public.customers RENAME TO hotel_customers;

COMMENT ON TABLE public.hotel_customers IS
  'Hotel/property customer profiles (stays, reservations, invoicing). Not retail_customers.';

COMMENT ON COLUMN public.reservations.property_customer_id IS
  'References public.hotel_customers(id).';

COMMENT ON COLUMN public.stays.property_customer_id IS
  'References public.hotel_customers(id).';

COMMENT ON COLUMN public.retail_invoices.property_customer_id IS
  'Hotel/mixed: links invoice to public.hotel_customers.id. retail_invoices.customer_id references retail_customers.';

NOTIFY pgrst, 'reload schema';
