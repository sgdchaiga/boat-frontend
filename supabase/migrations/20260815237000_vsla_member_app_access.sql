-- Secure, self-service VSLA member app access.
CREATE TABLE IF NOT EXISTS public.vsla_member_app_users (
  auth_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vsla_member_id uuid NOT NULL REFERENCES public.vsla_members(id) ON DELETE CASCADE,
  login_email text NOT NULL,
  login_phone text,
  pin_hash text,
  pin_failed_attempts integer NOT NULL DEFAULT 0,
  pin_locked_until timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','suspended','revoked')),
  invited_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  invited_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  must_change_password boolean NOT NULL DEFAULT false,
  UNIQUE (organization_id, vsla_member_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vsla_member_app_phone
  ON public.vsla_member_app_users((regexp_replace(login_phone, '\D', '', 'g')))
  WHERE login_phone IS NOT NULL;
ALTER TABLE public.vsla_member_app_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vsla_member_app_self_read" ON public.vsla_member_app_users
  FOR SELECT TO authenticated USING (auth_user_id = auth.uid());
CREATE POLICY "vsla_member_app_staff_manage" ON public.vsla_member_app_users
  FOR ALL TO authenticated
  USING (organization_id = public.auth_staff_org_id())
  WITH CHECK (organization_id = public.auth_staff_org_id());

CREATE OR REPLACE FUNCTION public.current_vsla_member_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT vsla_member_id FROM public.vsla_member_app_users
  WHERE auth_user_id = auth.uid() AND status IN ('invited','active') LIMIT 1
$$;
CREATE OR REPLACE FUNCTION public.current_vsla_member_org_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT organization_id FROM public.vsla_member_app_users
  WHERE auth_user_id = auth.uid() AND status IN ('invited','active') LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION public.current_vsla_member_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_vsla_member_org_id() TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_vsla_member_app_login()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.vsla_member_app_users SET status = CASE WHEN status='invited' THEN 'active' ELSE status END,
    last_login_at=now() WHERE auth_user_id=auth.uid() AND status IN ('invited','active')
$$;
GRANT EXECUTE ON FUNCTION public.mark_vsla_member_app_login() TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_vsla_member_password_change()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.vsla_member_app_users SET must_change_password=false
  WHERE auth_user_id=auth.uid() AND status IN ('invited','active')
$$;
GRANT EXECUTE ON FUNCTION public.complete_vsla_member_password_change() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_vsla_member_app_pin(p_member_id uuid, p_phone text, p_pin text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_org uuid; v_phone text; v_pin text;
BEGIN
  v_org := public.auth_staff_org_id();
  IF v_org IS NULL THEN RAISE EXCEPTION 'Only VSLA staff can set a member PIN'; END IF;
  v_phone := regexp_replace(coalesce(p_phone,''), '\D','','g');
  IF length(v_phone)=10 AND left(v_phone,1)='0' THEN v_phone := '256'||substr(v_phone,2);
  ELSIF length(v_phone)=9 THEN v_phone := '256'||v_phone; END IF;
  v_pin := trim(coalesce(p_pin,''));
  IF length(v_phone)<9 OR length(v_phone)>15 THEN RAISE EXCEPTION 'Enter a valid telephone number'; END IF;
  IF v_pin !~ '^[0-9]{6}$' THEN RAISE EXCEPTION 'Member PIN must be exactly 6 digits'; END IF;
  UPDATE public.vsla_member_app_users SET login_phone=v_phone, pin_hash=crypt(v_pin,gen_salt('bf')),
    pin_failed_attempts=0, pin_locked_until=NULL
  WHERE organization_id=v_org AND vsla_member_id=p_member_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member app account was not found'; END IF;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'That telephone number is already used by another VSLA member';
END; $$;
REVOKE ALL ON FUNCTION public.set_vsla_member_app_pin(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_vsla_member_app_pin(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.consume_vsla_member_pin_login(p_phone text, p_pin text)
RETURNS TABLE(auth_user_id uuid, login_email text, vsla_member_id uuid, organization_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_phone text; v_pin text; v_row public.vsla_member_app_users%ROWTYPE; v_failures integer;
BEGIN
  v_phone := regexp_replace(coalesce(p_phone,''), '\D','','g');
  IF length(v_phone)=10 AND left(v_phone,1)='0' THEN v_phone := '256'||substr(v_phone,2);
  ELSIF length(v_phone)=9 THEN v_phone := '256'||v_phone; END IF;
  v_pin := trim(coalesce(p_pin,''));
  IF length(v_phone)<9 OR v_pin !~ '^[0-9]{6}$' THEN RAISE EXCEPTION 'Invalid telephone or PIN'; END IF;
  SELECT * INTO v_row FROM public.vsla_member_app_users u
    WHERE regexp_replace(u.login_phone,'\D','','g')=v_phone LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR v_row.pin_hash IS NULL THEN RAISE EXCEPTION 'Invalid telephone or PIN'; END IF;
  IF v_row.status NOT IN ('invited','active') THEN RAISE EXCEPTION 'Member app access is suspended'; END IF;
  IF v_row.pin_locked_until IS NOT NULL AND v_row.pin_locked_until>now() THEN RAISE EXCEPTION 'PIN locked until %',v_row.pin_locked_until; END IF;
  IF crypt(v_pin,v_row.pin_hash)<>v_row.pin_hash THEN
    v_failures := v_row.pin_failed_attempts+1;
    UPDATE public.vsla_member_app_users SET pin_failed_attempts=CASE WHEN v_failures>=5 THEN 0 ELSE v_failures END,
      pin_locked_until=CASE WHEN v_failures>=5 THEN now()+interval '15 minutes' ELSE NULL END
      WHERE vsla_member_app_users.auth_user_id=v_row.auth_user_id;
    RETURN;
  END IF;
  UPDATE public.vsla_member_app_users SET pin_failed_attempts=0,pin_locked_until=NULL
    WHERE vsla_member_app_users.auth_user_id=v_row.auth_user_id;
  RETURN QUERY SELECT v_row.auth_user_id,v_row.login_email,v_row.vsla_member_id,v_row.organization_id;
END; $$;
REVOKE ALL ON FUNCTION public.consume_vsla_member_pin_login(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_vsla_member_pin_login(text,text) TO service_role;

-- Members can only see their profile and records. Meeting visibility is limited to their organization.
CREATE POLICY "vsla_members_member_self" ON public.vsla_members FOR SELECT TO authenticated
  USING (id=public.current_vsla_member_id());
CREATE POLICY "vsla_shares_member_self" ON public.vsla_share_transactions FOR SELECT TO authenticated
  USING (member_id=public.current_vsla_member_id());
CREATE POLICY "vsla_loans_member_self" ON public.vsla_loans FOR SELECT TO authenticated
  USING (member_id=public.current_vsla_member_id());
CREATE POLICY "vsla_repayments_member_self" ON public.vsla_loan_repayments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.vsla_loans l WHERE l.id=loan_id AND l.member_id=public.current_vsla_member_id()));
CREATE POLICY "vsla_fines_member_self" ON public.vsla_fines FOR SELECT TO authenticated
  USING (member_id=public.current_vsla_member_id());
CREATE POLICY "vsla_attendance_member_self" ON public.vsla_meeting_attendance FOR SELECT TO authenticated
  USING (member_id=public.current_vsla_member_id());
CREATE POLICY "vsla_meetings_member_org" ON public.vsla_meetings FOR SELECT TO authenticated
  USING (organization_id=public.current_vsla_member_org_id());
CREATE POLICY "vsla_cycles_member_org" ON public.vsla_cycles FOR SELECT TO authenticated
  USING (organization_id=public.current_vsla_member_org_id());

GRANT SELECT ON public.vsla_member_app_users, public.vsla_members, public.vsla_share_transactions,
  public.vsla_loans, public.vsla_loan_repayments, public.vsla_fines,
  public.vsla_meeting_attendance, public.vsla_meetings, public.vsla_cycles TO authenticated;
