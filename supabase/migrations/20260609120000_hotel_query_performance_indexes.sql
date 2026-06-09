-- Common hotel workspace filters use organization plus a date/status column.
-- These indexes keep those page loads fast as operational history grows.

CREATE INDEX IF NOT EXISTS idx_billing_org_charged_at
  ON public.billing (organization_id, charged_at DESC);

CREATE INDEX IF NOT EXISTS idx_reservations_org_checkout_checkin
  ON public.reservations (organization_id, check_out_date, check_in_date);

CREATE INDEX IF NOT EXISTS idx_stays_org_checkin_checkout
  ON public.stays (organization_id, actual_check_in, actual_check_out);

CREATE INDEX IF NOT EXISTS idx_hotel_customers_org_created
  ON public.hotel_customers (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_housekeeping_tasks_org_created
  ON public.housekeeping_tasks (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_kitchen_orders_org_created
  ON public.kitchen_orders (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_org_paid_at
  ON public.payments (organization_id, paid_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_org_transaction
  ON public.payments (organization_id, transaction_id);
