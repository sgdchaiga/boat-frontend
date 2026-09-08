-- Link Spend Money to Treasury approval and make credential rotation tenant-configurable.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS password_expiry_months integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS pin_expiry_months integer NOT NULL DEFAULT 3;

ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_password_expiry_months_check;
ALTER TABLE public.organizations ADD CONSTRAINT organizations_password_expiry_months_check CHECK (password_expiry_months BETWEEN 1 AND 24);
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_pin_expiry_months_check;
ALTER TABLE public.organizations ADD CONSTRAINT organizations_pin_expiry_months_check CHECK (pin_expiry_months BETWEEN 1 AND 24);

CREATE OR REPLACE FUNCTION public.save_credential_expiry_policy(p_password_months integer, p_pin_months integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid := public.auth_staff_org_id();
BEGIN
  IF v_org IS NULL OR NOT public.caller_is_org_admin_for(v_org) THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  IF p_password_months NOT BETWEEN 1 AND 24 OR p_pin_months NOT BETWEEN 1 AND 24 THEN RAISE EXCEPTION 'Expiry must be between 1 and 24 months'; END IF;
  UPDATE public.organizations SET password_expiry_months=p_password_months, pin_expiry_months=p_pin_months WHERE id=v_org;
END; $$;
REVOKE ALL ON FUNCTION public.save_credential_expiry_policy(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_credential_expiry_policy(integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.consume_staff_pin_login(p_staff_code text, p_pin text)
RETURNS TABLE (staff_id uuid, organization_id uuid, email text, full_name text, role text, pin_change_required boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_code text := public.normalize_staff_pin_code(p_staff_code); v_pin text := trim(coalesce(p_pin,'')); v_cred public.staff_pin_credentials%ROWTYPE; v_staff public.staff%ROWTYPE; v_months integer := 3;
BEGIN
  IF v_pin !~ '^[0-9]{4,6}$' THEN RAISE EXCEPTION 'Invalid staff code or PIN'; END IF;
  SELECT spc.* INTO v_cred FROM public.staff_pin_credentials spc WHERE spc.staff_code=v_code LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid staff code or PIN'; END IF;
  IF v_cred.locked_until IS NOT NULL AND v_cred.locked_until > now() THEN RAISE EXCEPTION 'PIN locked until %', v_cred.locked_until; END IF;
  SELECT s.* INTO v_staff FROM public.staff s WHERE s.id=v_cred.staff_id AND s.organization_id=v_cred.organization_id AND s.is_active=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Staff account is inactive'; END IF;
  IF crypt(v_pin,v_cred.pin_hash)<>v_cred.pin_hash THEN
    UPDATE public.staff_pin_credentials spc SET failed_attempts=spc.failed_attempts+1, locked_until=CASE WHEN spc.failed_attempts+1>=5 THEN now()+interval '15 minutes' ELSE spc.locked_until END, updated_at=now() WHERE spc.staff_id=v_cred.staff_id;
    RAISE EXCEPTION 'Invalid staff code or PIN';
  END IF;
  UPDATE public.staff_pin_credentials spc SET failed_attempts=0,locked_until=null,updated_at=now() WHERE spc.staff_id=v_cred.staff_id;
  SELECT coalesce(o.pin_expiry_months,3) INTO v_months FROM public.organizations o WHERE o.id=v_cred.organization_id;
  staff_id:=v_staff.id; organization_id:=v_staff.organization_id; email:=v_staff.email; full_name:=v_staff.full_name; role:=v_staff.role;
  pin_change_required:=v_cred.pin_change_required OR v_cred.pin_changed_at < now()-make_interval(months=>v_months); RETURN NEXT;
END; $$;
REVOKE ALL ON FUNCTION public.consume_staff_pin_login(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_staff_pin_login(text,text) TO service_role;

COMMENT ON TABLE public.treasury_requests IS 'Tenant-scoped approval and release queue. Spend Money enters pending approval when the organization workflow is enabled.';
