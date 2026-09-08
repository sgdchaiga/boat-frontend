-- Self-contained platform link RPC (does not depend on invite_organization_member existing at grant time).

CREATE OR REPLACE FUNCTION public.platform_link_organization_member(
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
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Platform administrator only';
  END IF;

  v_email := lower(trim(p_email));
  IF v_email = '' OR p_organization_id IS NULL OR trim(p_full_name) = '' OR trim(p_role) = '' THEN
    RAISE EXCEPTION 'Email, organization, name, and role are required';
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

REVOKE ALL ON FUNCTION public.platform_link_organization_member(text, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_link_organization_member(text, uuid, text, text, text) TO authenticated;
