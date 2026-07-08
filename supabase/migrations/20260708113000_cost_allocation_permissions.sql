WITH permission_keys(permission_key) AS (
  VALUES
    ('cost_allocation_manage'),
    ('cost_allocation_post')
)
INSERT INTO public.organization_permissions (organization_id, role_key, permission_key, allowed)
SELECT
  ort.organization_id,
  ort.role_key,
  pk.permission_key,
  CASE
    WHEN pk.permission_key = 'cost_allocation_manage' THEN ort.role_key IN ('admin', 'manager', 'accountant')
    WHEN pk.permission_key = 'cost_allocation_post' THEN ort.role_key IN ('admin', 'accountant')
    ELSE false
  END AS allowed
FROM public.organization_role_types ort
CROSS JOIN permission_keys pk
ON CONFLICT (organization_id, role_key, permission_key) DO NOTHING;
