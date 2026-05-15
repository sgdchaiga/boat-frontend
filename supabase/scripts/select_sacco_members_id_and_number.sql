-- Member id (UUID) and member number for one organization.
-- Replace the organization_id, or remove the WHERE to list all orgs (service role only).

SELECT
  m.id AS member_id,
  m.member_number,
  m.full_name,
  m.is_active,
  m.created_at
FROM public.sacco_members m
WHERE m.organization_id = '00000000-0000-0000-0000-000000000000' -- <<< your organization UUID
ORDER BY
  CASE WHEN m.member_number ~ '^\d+$' THEN m.member_number::bigint ELSE 999999999 END,
  m.member_number;
