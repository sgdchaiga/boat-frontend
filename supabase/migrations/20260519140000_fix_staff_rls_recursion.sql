-- Fix infinite recursion: staff policies must not subquery staff/organization_members inline.
-- Use SECURITY DEFINER helpers so policy checks do not re-enter RLS on the same table.

CREATE OR REPLACE FUNCTION public.auth_organization_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT uao.organization_id INTO v_org
  FROM public.user_active_organization uao
  WHERE uao.user_id = auth.uid();
  IF v_org IS NOT NULL THEN
    RETURN v_org;
  END IF;

  SELECT s.organization_id INTO v_org
  FROM public.staff s
  WHERE s.id = auth.uid();
  IF v_org IS NOT NULL THEN
    RETURN v_org;
  END IF;

  SELECT om.organization_id INTO v_org
  FROM public.organization_members om
  WHERE om.user_id = auth.uid()
    AND om.is_active = true
  ORDER BY om.last_accessed_at DESC NULLS LAST, om.created_at ASC
  LIMIT 1;

  RETURN v_org;
END;
$$;

CREATE OR REPLACE FUNCTION public.caller_is_org_admin_for(p_org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_org_id IS NULL THEN
    RETURN false;
  END IF;
  IF public.is_platform_admin() THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.user_id = auth.uid()
      AND om.organization_id = p_org_id
      AND om.is_active = true
      AND om.role = 'admin'
  ) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.staff s
    WHERE s.id = auth.uid()
      AND s.organization_id = p_org_id
      AND s.role IN ('admin', 'manager')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.caller_can_manage_staff_in_org(p_org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_org_id IS NULL THEN
    RETURN false;
  END IF;
  IF public.is_platform_admin() THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.user_id = auth.uid()
      AND om.organization_id = p_org_id
      AND om.is_active = true
      AND om.role IN ('admin', 'manager')
  ) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.staff s
    WHERE s.id = auth.uid()
      AND s.organization_id = p_org_id
      AND s.role IN ('admin', 'manager')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.can_view_staff_row(p_staff_id uuid, p_staff_org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  IF p_staff_id = auth.uid() THEN
    RETURN true;
  END IF;
  IF public.is_platform_admin() THEN
    RETURN true;
  END IF;

  v_active := public.auth_organization_id();
  IF v_active IS NULL THEN
    RETURN false;
  END IF;

  IF p_staff_org_id IS NOT NULL AND p_staff_org_id = v_active THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.user_id = p_staff_id
      AND om.organization_id = v_active
      AND om.is_active = true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.auth_organization_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.caller_is_org_admin_for(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.caller_can_manage_staff_in_org(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_staff_row(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.auth_organization_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.caller_is_org_admin_for(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.caller_can_manage_staff_in_org(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_staff_row(uuid, uuid) TO authenticated;

-- organization_members: no inline staff subqueries
DROP POLICY IF EXISTS "organization_members_insert_admin" ON public.organization_members;
CREATE POLICY "organization_members_insert_admin"
  ON public.organization_members FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR public.caller_is_org_admin_for(organization_id)
  );

DROP POLICY IF EXISTS "organization_members_update_admin" ON public.organization_members;
CREATE POLICY "organization_members_update_admin"
  ON public.organization_members FOR UPDATE
  TO authenticated
  USING (
    public.is_platform_admin()
    OR public.caller_is_org_admin_for(organization_id)
  )
  WITH CHECK (
    public.is_platform_admin()
    OR public.caller_is_org_admin_for(organization_id)
  );

-- staff SELECT: no inline cross-table subqueries in policy expression
DROP POLICY IF EXISTS "staff_select_same_org" ON public.staff;
CREATE POLICY "staff_select_same_org"
  ON public.staff FOR SELECT
  TO authenticated
  USING (public.can_view_staff_row(id, organization_id));

-- staff INSERT/UPDATE: no self-subquery on staff in policy
DROP POLICY IF EXISTS "staff_insert_same_org_admin" ON public.staff;
DROP POLICY IF EXISTS "staff_update_same_org_admin" ON public.staff;

CREATE POLICY "staff_insert_same_org_admin"
  ON public.staff FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IS NOT NULL
    AND (
      public.is_platform_admin()
      OR (
        organization_id = public.auth_organization_id()
        AND public.caller_can_manage_staff_in_org(organization_id)
      )
    )
  );

CREATE POLICY "staff_update_same_org_admin"
  ON public.staff FOR UPDATE
  TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      organization_id = public.auth_organization_id()
      AND public.caller_can_manage_staff_in_org(organization_id)
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (
      organization_id = public.auth_organization_id()
      AND public.caller_can_manage_staff_in_org(organization_id)
    )
  );
