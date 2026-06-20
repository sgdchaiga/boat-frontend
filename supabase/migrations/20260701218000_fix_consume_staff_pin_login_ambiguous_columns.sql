-- Qualify table columns that share names with RETURNS TABLE output variables.
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
SET search_path = public, extensions
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

  SELECT spc.*
  INTO v_cred
  FROM public.staff_pin_credentials AS spc
  WHERE spc.staff_code = v_code
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid staff code or PIN';
  END IF;

  IF v_cred.locked_until IS NOT NULL AND v_cred.locked_until > now() THEN
    RAISE EXCEPTION 'PIN locked until %', v_cred.locked_until;
  END IF;

  SELECT s.*
  INTO v_staff
  FROM public.staff AS s
  WHERE s.id = v_cred.staff_id
    AND s.organization_id = v_cred.organization_id
    AND s.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff account is inactive';
  END IF;

  IF crypt(v_pin, v_cred.pin_hash) <> v_cred.pin_hash THEN
    UPDATE public.staff_pin_credentials AS spc
    SET failed_attempts = spc.failed_attempts + 1,
        locked_until = CASE
          WHEN spc.failed_attempts + 1 >= 5 THEN now() + interval '15 minutes'
          ELSE spc.locked_until
        END,
        updated_at = now()
    WHERE spc.staff_id = v_cred.staff_id;
    RAISE EXCEPTION 'Invalid staff code or PIN';
  END IF;

  UPDATE public.staff_pin_credentials AS spc
  SET failed_attempts = 0,
      locked_until = null,
      updated_at = now()
  WHERE spc.staff_id = v_cred.staff_id;

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

REVOKE ALL ON FUNCTION public.consume_staff_pin_login(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_staff_pin_login(text, text) TO service_role;
