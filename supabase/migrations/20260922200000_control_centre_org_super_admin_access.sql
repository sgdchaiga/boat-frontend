-- Correct the initial rollout policy: the normal BOAT "Super Admin" role is
-- organization-scoped. Platform superusers retain cross-organization access.
CREATE OR REPLACE FUNCTION public.control_centre_can(p_organization_id uuid, p_permission text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_platform_admin() THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.user_id = auth.uid()
      AND om.organization_id = p_organization_id
      AND om.is_active = true
      AND om.role = 'super_admin'
  );
END;
$$;

COMMENT ON FUNCTION public.control_centre_can(uuid, text) IS
  'Initial rollout policy: only an organization Super Admin or a platform superuser may access Control Centre. Future page-level grants will replace this policy.';
