-- Organization super admins must be able to manage staff PIN credentials.
-- The original PIN migration predates caller_is_org_super_admin_for(), so its
-- authorization check recognized only platform admins and organization admins.

DROP POLICY IF EXISTS staff_pin_credentials_admin_select ON public.staff_pin_credentials;
CREATE POLICY staff_pin_credentials_admin_select
  ON public.staff_pin_credentials FOR SELECT
  TO authenticated
  USING (
    public.is_platform_admin()
    OR public.caller_is_org_super_admin_for(organization_id)
    OR public.caller_is_org_admin_for(organization_id)
    OR staff_id = auth.uid()
  );

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
SET search_path = public, extensions
AS $$
DECLARE
  v_code text := public.normalize_staff_pin_code(p_staff_code);
  v_pin text := trim(coalesce(p_pin, ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT (
    public.is_platform_admin()
    OR public.caller_is_org_super_admin_for(p_organization_id)
    OR public.caller_is_org_admin_for(p_organization_id)
  ) THEN
    RAISE EXCEPTION 'Administrator or super-admin access required';
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

REVOKE ALL ON FUNCTION public.set_staff_pin_credential(uuid, uuid, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_staff_pin_credential(uuid, uuid, text, text, boolean) TO authenticated;
