-- organization_members.user_id must reference auth.users.id.
-- Skip orphan staff rows (local/desktop UUIDs with no Supabase Auth login).

DELETE FROM public.organization_members om
WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = om.user_id);

DELETE FROM public.user_active_organization uao
WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = uao.user_id);

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

CREATE OR REPLACE FUNCTION public.trg_staff_ensure_org_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.id) THEN
    RETURN NEW;
  END IF;

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

  RETURN NEW;
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
  v_staff_id uuid;
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
    SELECT s.id INTO v_staff_id
    FROM public.staff s
    WHERE lower(s.email) = v_email
    LIMIT 1;

    IF v_staff_id IS NOT NULL THEN
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

REVOKE ALL ON FUNCTION public.invite_organization_member(text, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invite_organization_member(text, uuid, text, text, text) TO authenticated;
