-- Least-privilege hybrid role for small hospitality businesses where one staff
-- member covers waiter/bar service, front desk, PO preparation and expenses.
INSERT INTO public.organization_role_types (
  organization_id,
  role_key,
  display_name,
  sort_order,
  can_edit_pos_orders,
  can_edit_cash_receipts
)
SELECT
  o.id,
  'hotel_operations_assistant',
  'Hotel Operations Assistant',
  75,
  false,
  false
FROM public.organizations o
WHERE lower(coalesce(o.business_type, '')) IN ('hotel', 'mixed', 'restaurant')
ON CONFLICT (organization_id, role_key) DO UPDATE
SET display_name = EXCLUDED.display_name,
    sort_order = EXCLUDED.sort_order,
    can_edit_pos_orders = false,
    can_edit_cash_receipts = false;

-- Explicitly deny approval/elevated action permissions. Page entry for purchase
-- orders is intentionally separate from permission to approve a purchase order.
WITH permission_keys(permission_key) AS (
  VALUES
    ('purchase_orders'),
    ('bills'),
    ('vendor_credits'),
    ('chart_of_accounts'),
    ('sacco_savings_settings'),
    ('sacco_transaction_edit'),
    ('payroll_prepare'),
    ('payroll_approve'),
    ('payroll_post'),
    ('pos_orders_edit'),
    ('cash_receipts_edit'),
    ('stock_adjustments_delete'),
    ('cost_allocation_manage'),
    ('cost_allocation_post')
)
INSERT INTO public.organization_permissions (organization_id, role_key, permission_key, allowed)
SELECT
  ort.organization_id,
  ort.role_key,
  pk.permission_key,
  false
FROM public.organization_role_types ort
CROSS JOIN permission_keys pk
WHERE ort.role_key = 'hotel_operations_assistant'
ON CONFLICT (organization_id, role_key, permission_key) DO UPDATE
SET allowed = false;
