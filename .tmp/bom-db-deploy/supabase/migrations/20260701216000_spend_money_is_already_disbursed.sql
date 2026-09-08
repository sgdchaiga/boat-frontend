-- Spend Money records cash-paid expenses. They must not wait for a second
-- release in Treasury; Treasury keeps them as completed disbursement history.

UPDATE public.treasury_requests
SET
  status = 'disbursed',
  approved_by = COALESCE(approved_by, requested_by),
  approved_at = COALESCE(approved_at, requested_at),
  disbursed_by = COALESCE(disbursed_by, requested_by),
  disbursed_at = COALESCE(disbursed_at, requested_at),
  updated_at = now()
WHERE source_type = 'expense'
  AND status IN ('pending_approval', 'approved');

COMMENT ON TABLE public.treasury_requests IS
  'Tenant-scoped Treasury history and supplier-bill release queue. Spend Money expenses are already disbursed; approved bills await release.';
