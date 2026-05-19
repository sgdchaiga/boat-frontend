-- Cloud multi-organization: one login (auth.users) can belong to many organizations.
-- Active workspace is stored in user_active_organization and mirrored on staff.organization_id for RLS.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'receptionist',
  full_name text NOT NULL DEFAULT '',
  phone text,
  is_active boolean NOT NULL DEFAULT true,
  last_accessed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_members_user_org_uq UNIQUE (user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_organization_members_org
  ON public.organization_members (organization_id, is_active);

CREATE INDEX IF NOT EXISTS idx_organization_members_user
  ON public.organization_members (user_id, is_active);

CREATE TABLE IF NOT EXISTS public.user_active_organization (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Allow same email across orgs (email lives on auth.users / staff profile).
ALTER TABLE public.staff DROP CONSTRAINT IF EXISTS staff_email_key;

-- ---------------------------------------------------------------------------
-- Backfill memberships from existing staff rows
-- ---------------------------------------------------------------------------
INSERT INTO public.organization_members (user_id, organization_id, role, full_name, phone, is_active, created_at, updated_at)
SELECT
  s.id,
  s.organization_id,
  COALESCE(NULLIF(trim(s.role), ''), 'receptionist'),
  COALESCE(NULLIF(trim(s.full_name), ''), 'Staff'),
  s.phone,
  COALESCE(s.is_active, true),
  COALESCE(s.created_at, now()),
  now()
FROM public.staff s
WHERE s.organization_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = s.id)
ON CONFLICT (user_id, organization_id) DO UPDATE SET
  role = EXCLUDED.role,
  full_name = EXCLUDED.full_name,
  phone = EXCLUDED.phone,
  is_active = EXCLUDED.is_active,
  updated_at = now();

INSERT INTO public.user_active_organization (user_id, organization_id, updated_at)
SELECT s.id, s.organization_id, now()
FROM public.staff s
WHERE s.organization_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = s.id)
ON CONFLICT (user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
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
  FROM public.user_active_organization uao WHERE uao.user_id = auth.uid();
  IF v_org IS NOT NULL THEN RETURN v_org; END IF;
  SELECT s.organization_id INTO v_org FROM public.staff s WHERE s.id = auth.uid();
  IF v_org IS NOT NULL THEN RETURN v_org; END IF;
  SELECT om.organization_id INTO v_org
  FROM public.organization_members om
  WHERE om.user_id = auth.uid() AND om.is_active = true
  ORDER BY om.last_accessed_at DESC NULLS LAST, om.created_at ASC
  LIMIT 1;
  RETURN v_org;
END;
$$;

CREATE OR REPLACE FUNCTION public.user_is_member_of_org(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.user_id = auth.uid()
      AND om.organization_id = p_org_id
      AND om.is_active = true
  )
  OR public.is_platform_admin();
$$;

CREATE OR REPLACE FUNCTION public.sync_staff_from_active_membership()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_member public.organization_members%ROWTYPE;
  v_email text;
BEGIN
  v_org_id := public.auth_organization_id();
  IF v_org_id IS NULL OR auth.uid() IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_member
  FROM public.organization_members om
  WHERE om.user_id = auth.uid()
    AND om.organization_id = v_org_id
    AND om.is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT lower(u.email) INTO v_email
  FROM auth.users u
  WHERE u.id = auth.uid();

  UPDATE public.organization_members
  SET last_accessed_at = now(), updated_at = now()
  WHERE user_id = auth.uid() AND organization_id = v_org_id;

  INSERT INTO public.staff (id, email, full_name, phone, role, organization_id, is_active)
  VALUES (
    auth.uid(),
    COALESCE(v_email, ''),
    v_member.full_name,
    v_member.phone,
    v_member.role,
    v_org_id,
    v_member.is_active
  )
  ON CONFLICT (id) DO UPDATE SET
    email = COALESCE(EXCLUDED.email, public.staff.email),
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    role = EXCLUDED.role,
    organization_id = EXCLUDED.organization_id,
    is_active = EXCLUDED.is_active;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_active_organization(p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Organization is required';
  END IF;

  IF NOT public.user_is_member_of_org(p_organization_id) AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'You are not a member of this organization';
  END IF;

  INSERT INTO public.user_active_organization (user_id, organization_id, updated_at)
  VALUES (auth.uid(), p_organization_id, now())
  ON CONFLICT (user_id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    updated_at = now();

  PERFORM public.sync_staff_from_active_membership();
END;
$$;

CREATE OR REPLACE FUNCTION public.invite_organization_member(
  p_email text,
  p_organization_id uuid,
  p_role text,
  p_full_name text,
  p_phone text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_email := lower(trim(p_email));
  IF v_email = '' OR p_organization_id IS NULL OR trim(p_full_name) = '' OR trim(p_role) = '' THEN
    RAISE EXCEPTION 'Email, organization, name, and role are required';
  END IF;

  IF p_organization_id IS DISTINCT FROM public.auth_organization_id() AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Cannot invite users to another organization';
  END IF;

  IF NOT public.is_platform_admin() AND NOT EXISTS (
    SELECT 1 FROM public.staff me
    WHERE me.id = auth.uid()
      AND me.role = 'admin'
      AND me.organization_id = public.auth_organization_id()
  ) THEN
    RAISE EXCEPTION 'Only organization administrators can invite users';
  END IF;

  SELECT u.id INTO v_user_id
  FROM auth.users u
  WHERE lower(u.email) = v_email
  LIMIT 1;

  IF v_user_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.staff s WHERE lower(s.email) = v_email) THEN
      RAISE EXCEPTION
        'Staff record exists for % but there is no Auth login (auth.users). Create the user with a password under Business admins or Admin → Users, then link again.',
        p_email;
    END IF;
    RAISE EXCEPTION 'No login exists for this email. Create the user with a password first, or ask them to sign up.';
  END IF;

  INSERT INTO public.organization_members (user_id, organization_id, role, full_name, phone, is_active)
  VALUES (v_user_id, p_organization_id, p_role, trim(p_full_name), NULLIF(trim(p_phone), ''), true)
  ON CONFLICT (user_id, organization_id) DO UPDATE SET
    role = EXCLUDED.role,
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    is_active = true,
    updated_at = now();

  INSERT INTO public.staff (id, email, full_name, phone, role, organization_id, is_active)
  VALUES (v_user_id, v_email, trim(p_full_name), NULLIF(trim(p_phone), ''), p_role, p_organization_id, true)
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    role = CASE
      WHEN public.staff.organization_id = p_organization_id OR public.staff.organization_id IS NULL
      THEN EXCLUDED.role
      ELSE public.staff.role
    END,
    organization_id = COALESCE(public.staff.organization_id, EXCLUDED.organization_id),
    is_active = EXCLUDED.is_active;

  RETURN v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.auth_organization_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_is_member_of_org(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_staff_from_active_membership() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_active_organization(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invite_organization_member(text, uuid, text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.auth_organization_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_is_member_of_org(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_staff_from_active_membership() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_active_organization(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_organization_member(text, uuid, text, text, text) TO authenticated;

-- Triggers: keep membership in sync when staff is provisioned the legacy way
CREATE OR REPLACE FUNCTION public.trg_staff_ensure_org_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.organization_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.id) THEN
    INSERT INTO public.organization_members (user_id, organization_id, role, full_name, phone, is_active)
    VALUES (
      NEW.id,
      NEW.organization_id,
      COALESCE(NULLIF(trim(NEW.role), ''), 'receptionist'),
      COALESCE(NULLIF(trim(NEW.full_name), ''), 'Staff'),
      NEW.phone,
      COALESCE(NEW.is_active, true)
    )
    ON CONFLICT (user_id, organization_id) DO UPDATE SET
      role = EXCLUDED.role,
      full_name = EXCLUDED.full_name,
      phone = EXCLUDED.phone,
      is_active = EXCLUDED.is_active,
      updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_staff_ensure_org_member ON public.staff;
CREATE TRIGGER trg_staff_ensure_org_member
AFTER INSERT OR UPDATE OF organization_id, role, full_name, phone, is_active ON public.staff
FOR EACH ROW
EXECUTE FUNCTION public.trg_staff_ensure_org_member();

-- Insert triggers: use active org
CREATE OR REPLACE FUNCTION public.set_org_id_from_auth_staff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := public.auth_organization_id();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_organization_id_text()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.auth_organization_id()::text;
$$;

-- ---------------------------------------------------------------------------
-- RLS: organization_members & user_active_organization
-- ---------------------------------------------------------------------------
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_active_organization ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "organization_members_select" ON public.organization_members;
CREATE POLICY "organization_members_select"
  ON public.organization_members FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR organization_id = public.auth_organization_id()
    OR public.is_platform_admin()
  );

-- organization_members admin policies are defined in 20260519140000_fix_staff_rls_recursion.sql
-- (helpers must exist first; avoid inline staff subqueries here).

DROP POLICY IF EXISTS "user_active_organization_self" ON public.user_active_organization;
CREATE POLICY "user_active_organization_self"
  ON public.user_active_organization FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- staff SELECT/INSERT/UPDATE policies: see 20260519140000_fix_staff_rls_recursion.sql
