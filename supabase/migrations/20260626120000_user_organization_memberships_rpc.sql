-- Return all active organization memberships with org display names for the signed-in user.
-- Used by org picker / switcher when PostgREST embed or organizations RLS hides non-active orgs.

CREATE OR REPLACE FUNCTION public.get_user_organization_memberships()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN coalesce(
    (
      SELECT jsonb_agg(row_data ORDER BY sort_ts DESC NULLS LAST)
      FROM (
        SELECT
          jsonb_build_object(
            'organization_id', om.organization_id,
            'role', om.role,
            'full_name', om.full_name,
            'phone', om.phone,
            'is_active', om.is_active,
            'last_accessed_at', om.last_accessed_at,
            'organizations', jsonb_build_object(
              'id', o.id,
              'name', o.name,
              'business_type', o.business_type,
              'logo_url', o.logo_url
            )
          ) AS row_data,
          om.last_accessed_at AS sort_ts
        FROM public.organization_members om
        INNER JOIN public.organizations o ON o.id = om.organization_id
        WHERE om.user_id = v_uid
          AND om.is_active = true
      ) sub
    ),
    '[]'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_organization_memberships() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_organization_memberships() TO authenticated;

COMMENT ON FUNCTION public.get_user_organization_memberships IS
  'Lists active organization_members rows for auth.uid() with organization name/type for multi-org picker and switcher.';

-- Ensure members can still read linked orgs via direct SELECT (embed fallback).
DROP POLICY IF EXISTS "member_read_linked_organizations" ON public.organizations;

CREATE POLICY "member_read_linked_organizations"
  ON public.organizations FOR SELECT
  TO authenticated
  USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.user_id = auth.uid()
        AND om.organization_id = organizations.id
        AND om.is_active = true
    )
  );
