-- Control Centre is in a platform-admin-only rollout phase. Keep the existing
-- role/permission records for the later delegated-access rollout, but do not
-- honor them until that access-management interface is introduced.
CREATE OR REPLACE FUNCTION public.control_centre_can(p_organization_id uuid, p_permission text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.is_platform_admin();
END;
$$;

COMMENT ON FUNCTION public.control_centre_can(uuid, text) IS
  'Temporary rollout policy: only platform super administrators may access Control Centre. Future page-level grants will replace this policy.';
