-- Online staff PIN access: staff_code + 4-6 digit PIN credentials.
-- PINs are verified by SECURITY DEFINER RPCs and the Edge Function then creates
-- a normal Supabase Auth magic-link session, so app RLS continues to work.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.staff_pin_credentials (
  staff_id uuid PRIMARY KEY REFERENCES public.staff(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  staff_code text NOT NULL,
  pin_hash text NOT NULL,
  pin_set_at timestamptz NOT NULL DEFAULT now(),
  pin_changed_at timestamptz NOT NULL DEFAULT now(),
  pin_change_required boolean NOT NULL DEFAULT false,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_pin_credentials_code_len CHECK (char_length(staff_code) BETWEEN 3 AND 32),
  CONSTRAINT staff_pin_credentials_code_format CHECK (staff_code ~ '^[A-Z0-9_-]+$')
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_pin_credentials_staff_code_uq
  ON public.staff_pin_credentials (staff_code);

CREATE INDEX IF NOT EXISTS idx_staff_pin_credentials_org
  ON public.staff_pin_credentials (organization_id);

ALTER TABLE public.staff_pin_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_pin_credentials_admin_select ON public.staff_pin_credentials;
CREATE POLICY staff_pin_credentials_admin_select
  ON public.staff_pin_credentials FOR SELECT
  TO authenticated
  USING (
    public.is_platform_admin()
    OR public.caller_is_org_admin_for(organization_id)
    OR staff_id = auth.uid()
  );

CREATE OR REPLACE FUNCTION public.normalize_staff_pin_code(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(upper(trim(coalesce(raw, ''))), '[^A-Z0-9_-]', '', 'g')
$$;

CREATE OR REPLACE FUNCTION public.set_staff_pin_credential(
  p_staff_id uuid,
  p_organization_id uuid,
  p_staff_code text,
  p_pin text,
  p_force_change boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text := public.normalize_staff_pin_code(p_staff_code);
  v_pin text := trim(coalesce(p_pin, ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT (public.is_platform_admin() OR public.caller_is_org_admin_for(p_organization_id)) THEN
    RAISE EXCEPTION 'Administrator access required';
  END IF;

  IF v_code = '' OR char_length(v_code) < 3 OR char_length(v_code) > 32 THEN
    RAISE EXCEPTION 'Staff code must be 3-32 letters, numbers, underscores, or hyphens.';
  END IF;

  IF v_pin !~ '^[0-9]{4,6}$' THEN
    RAISE EXCEPTION 'PIN must be 4-6 digits.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.staff s
    WHERE s.id = p_staff_id
      AND s.organization_id = p_organization_id
      AND s.is_active = true
  ) THEN
    RAISE EXCEPTION 'Active staff member not found in this organization.';
  END IF;

  INSERT INTO public.staff_pin_credentials(
    staff_id,
    organization_id,
    staff_code,
    pin_hash,
    pin_set_at,
    pin_changed_at,
    pin_change_required,
    failed_attempts,
    locked_until,
    updated_at
  )
  VALUES (
    p_staff_id,
    p_organization_id,
    v_code,
    crypt(v_pin, gen_salt('bf')),
    now(),
    now(),
    coalesce(p_force_change, false),
    0,
    null,
    now()
  )
  ON CONFLICT (staff_id) DO UPDATE
  SET organization_id = EXCLUDED.organization_id,
      staff_code = EXCLUDED.staff_code,
      pin_hash = EXCLUDED.pin_hash,
      pin_changed_at = now(),
      pin_change_required = EXCLUDED.pin_change_required,
      failed_attempts = 0,
      locked_until = null,
      updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_staff_pin_login(
  p_staff_code text,
  p_pin text
)
RETURNS TABLE (
  staff_id uuid,
  organization_id uuid,
  email text,
  full_name text,
  role text,
  pin_change_required boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text := public.normalize_staff_pin_code(p_staff_code);
  v_pin text := trim(coalesce(p_pin, ''));
  v_cred public.staff_pin_credentials%ROWTYPE;
  v_staff public.staff%ROWTYPE;
BEGIN
  IF v_pin !~ '^[0-9]{4,6}$' THEN
    RAISE EXCEPTION 'Invalid staff code or PIN';
  END IF;

  SELECT *
  INTO v_cred
  FROM public.staff_pin_credentials
  WHERE staff_code = v_code
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid staff code or PIN';
  END IF;

  IF v_cred.locked_until IS NOT NULL AND v_cred.locked_until > now() THEN
    RAISE EXCEPTION 'PIN locked until %', v_cred.locked_until;
  END IF;

  SELECT *
  INTO v_staff
  FROM public.staff
  WHERE id = v_cred.staff_id
    AND organization_id = v_cred.organization_id
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff account is inactive';
  END IF;

  IF crypt(v_pin, v_cred.pin_hash) <> v_cred.pin_hash THEN
    UPDATE public.staff_pin_credentials
    SET failed_attempts = failed_attempts + 1,
        locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END,
        updated_at = now()
    WHERE staff_id = v_cred.staff_id;
    RAISE EXCEPTION 'Invalid staff code or PIN';
  END IF;

  UPDATE public.staff_pin_credentials
  SET failed_attempts = 0,
      locked_until = null,
      updated_at = now()
  WHERE staff_id = v_cred.staff_id;

  staff_id := v_staff.id;
  organization_id := v_staff.organization_id;
  email := v_staff.email;
  full_name := v_staff.full_name;
  role := v_staff.role;
  pin_change_required := v_cred.pin_change_required
    OR v_cred.pin_changed_at < now() - interval '90 days';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.set_staff_pin_credential(uuid, uuid, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_staff_pin_credential(uuid, uuid, text, text, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.consume_staff_pin_login(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_staff_pin_login(text, text) TO service_role;
