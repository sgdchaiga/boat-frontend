CREATE TABLE IF NOT EXISTS public.sacco_member_app_users (
  auth_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sacco_member_id uuid NOT NULL REFERENCES public.sacco_members(id) ON DELETE CASCADE,
  login_email text NOT NULL,
  login_phone text,
  pin_hash text,
  pin_failed_attempts integer NOT NULL DEFAULT 0,
  pin_locked_until timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'suspended', 'revoked')),
  invited_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  invited_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  must_change_password boolean NOT NULL DEFAULT true,
  UNIQUE (organization_id, sacco_member_id)
);

-- Upgrade installations where this table was created by an earlier version of
-- the member-app migration. CREATE TABLE IF NOT EXISTS does not add columns.
ALTER TABLE public.sacco_member_app_users
  ADD COLUMN IF NOT EXISTS login_phone text,
  ADD COLUMN IF NOT EXISTS pin_hash text,
  ADD COLUMN IF NOT EXISTS pin_failed_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_sacco_member_app_users_member
  ON public.sacco_member_app_users(organization_id, sacco_member_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sacco_member_app_users_org_email
  ON public.sacco_member_app_users(organization_id, lower(login_email));
CREATE UNIQUE INDEX IF NOT EXISTS idx_sacco_member_app_users_login_phone
  ON public.sacco_member_app_users((regexp_replace(login_phone, '\D', '', 'g')))
  WHERE login_phone IS NOT NULL;

ALTER TABLE public.sacco_member_app_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "member_app_access_self_read" ON public.sacco_member_app_users;
DROP POLICY IF EXISTS "member_app_access_staff_manage" ON public.sacco_member_app_users;
CREATE POLICY "member_app_access_self_read" ON public.sacco_member_app_users
  FOR SELECT TO authenticated USING (auth_user_id = auth.uid());
CREATE POLICY "member_app_access_staff_manage" ON public.sacco_member_app_users
  FOR ALL TO authenticated
  USING (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
  WITH CHECK (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

CREATE OR REPLACE FUNCTION public.current_sacco_member_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT mau.sacco_member_id
  FROM public.sacco_member_app_users mau
  WHERE mau.auth_user_id = auth.uid() AND mau.status IN ('invited', 'active')
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.current_sacco_member_org_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT mau.organization_id
  FROM public.sacco_member_app_users mau
  WHERE mau.auth_user_id = auth.uid() AND mau.status IN ('invited', 'active')
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.current_sacco_member_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_sacco_member_org_id() TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_sacco_member_app_login()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.sacco_member_app_users
  SET status = CASE WHEN status = 'invited' THEN 'active' ELSE status END,
      last_login_at = now()
  WHERE auth_user_id = auth.uid() AND status IN ('invited', 'active')
$$;
GRANT EXECUTE ON FUNCTION public.mark_sacco_member_app_login() TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_sacco_member_password_change()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.sacco_member_app_users
  SET must_change_password = false
  WHERE auth_user_id = auth.uid() AND status IN ('invited', 'active')
$$;
GRANT EXECUTE ON FUNCTION public.complete_sacco_member_password_change() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_sacco_member_app_pin(p_member_id uuid, p_phone text, p_pin text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_org uuid; v_phone text; v_pin text;
BEGIN
  v_org := (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid());
  IF v_org IS NULL THEN RAISE EXCEPTION 'Only SACCO staff can set a member PIN'; END IF;
  v_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  IF length(v_phone) = 10 AND left(v_phone, 1) = '0' THEN v_phone := '256' || substr(v_phone, 2);
  ELSIF length(v_phone) = 9 THEN v_phone := '256' || v_phone; END IF;
  v_pin := trim(coalesce(p_pin, ''));
  IF length(v_phone) < 9 OR length(v_phone) > 15 THEN RAISE EXCEPTION 'Enter a valid telephone number'; END IF;
  IF v_pin !~ '^[0-9]{6}$' THEN RAISE EXCEPTION 'Member PIN must be exactly 6 digits'; END IF;
  UPDATE public.sacco_member_app_users
  SET login_phone = v_phone, pin_hash = crypt(v_pin, gen_salt('bf')), pin_failed_attempts = 0, pin_locked_until = NULL
  WHERE organization_id = v_org AND sacco_member_id = p_member_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member app account was not found'; END IF;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'That telephone number is already used by another member app account';
END;
$$;
REVOKE ALL ON FUNCTION public.set_sacco_member_app_pin(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_sacco_member_app_pin(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.consume_sacco_member_pin_login(p_phone text, p_pin text)
RETURNS TABLE(auth_user_id uuid, login_email text, sacco_member_id uuid, organization_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_phone text; v_pin text; v_row public.sacco_member_app_users%ROWTYPE; v_failures integer;
BEGIN
  v_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  IF length(v_phone) = 10 AND left(v_phone, 1) = '0' THEN v_phone := '256' || substr(v_phone, 2);
  ELSIF length(v_phone) = 9 THEN v_phone := '256' || v_phone; END IF;
  v_pin := trim(coalesce(p_pin, ''));
  IF length(v_phone) < 9 OR v_pin !~ '^[0-9]{6}$' THEN RAISE EXCEPTION 'Invalid telephone or PIN'; END IF;
  SELECT * INTO v_row FROM public.sacco_member_app_users mau
  WHERE regexp_replace(mau.login_phone, '\D', '', 'g') = v_phone LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR v_row.pin_hash IS NULL THEN RAISE EXCEPTION 'Invalid telephone or PIN'; END IF;
  IF v_row.status NOT IN ('invited', 'active') THEN RAISE EXCEPTION 'Member app access is suspended'; END IF;
  IF v_row.pin_locked_until IS NOT NULL AND v_row.pin_locked_until > now() THEN RAISE EXCEPTION 'PIN locked until %', v_row.pin_locked_until; END IF;
  IF crypt(v_pin, v_row.pin_hash) <> v_row.pin_hash THEN
    v_failures := v_row.pin_failed_attempts + 1;
    UPDATE public.sacco_member_app_users SET pin_failed_attempts = CASE WHEN v_failures >= 5 THEN 0 ELSE v_failures END,
      pin_locked_until = CASE WHEN v_failures >= 5 THEN now() + interval '15 minutes' ELSE NULL END
    WHERE sacco_member_app_users.auth_user_id = v_row.auth_user_id;
    RAISE EXCEPTION 'Invalid telephone or PIN';
  END IF;
  UPDATE public.sacco_member_app_users SET pin_failed_attempts = 0, pin_locked_until = NULL
  WHERE sacco_member_app_users.auth_user_id = v_row.auth_user_id;
  RETURN QUERY SELECT v_row.auth_user_id, v_row.login_email, v_row.sacco_member_id, v_row.organization_id;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_sacco_member_pin_login(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_sacco_member_pin_login(text, text) TO service_role;

DROP POLICY IF EXISTS "sacco_members_member_self" ON public.sacco_members;
CREATE POLICY "sacco_members_member_self" ON public.sacco_members
  FOR SELECT TO authenticated USING (id = public.current_sacco_member_id());
DROP POLICY IF EXISTS "sacco_savings_member_self" ON public.sacco_member_savings_accounts;
CREATE POLICY "sacco_savings_member_self" ON public.sacco_member_savings_accounts
  FOR SELECT TO authenticated USING (sacco_member_id = public.current_sacco_member_id());
DROP POLICY IF EXISTS "sacco_loans_member_self" ON public.sacco_loans;
DROP POLICY IF EXISTS "sacco_loans_member_apply" ON public.sacco_loans;
CREATE POLICY "sacco_loans_member_self" ON public.sacco_loans
  FOR SELECT TO authenticated USING (sacco_member_id = public.current_sacco_member_id());
CREATE POLICY "sacco_loans_member_apply" ON public.sacco_loans
  FOR INSERT TO authenticated WITH CHECK (
    sacco_member_id = public.current_sacco_member_id()
    AND organization_id = public.current_sacco_member_org_id()
    AND status = 'pending'
    AND approval_stage = 0
    AND paid_amount = 0
    AND balance = amount
  );
DROP POLICY IF EXISTS "sacco_fd_member_self" ON public.sacco_fixed_deposits;
CREATE POLICY "sacco_fd_member_self" ON public.sacco_fixed_deposits
  FOR SELECT TO authenticated USING (sacco_member_id = public.current_sacco_member_id());
DROP POLICY IF EXISTS "sacco_cashbook_member_self" ON public.sacco_cashbook_entries;
CREATE POLICY "sacco_cashbook_member_self" ON public.sacco_cashbook_entries
  FOR SELECT TO authenticated USING (sacco_member_id = public.current_sacco_member_id());
DROP POLICY IF EXISTS "sacco_loan_products_member_read" ON public.sacco_loan_products;
CREATE POLICY "sacco_loan_products_member_read" ON public.sacco_loan_products
  FOR SELECT TO authenticated USING (organization_id = public.current_sacco_member_org_id());

DROP POLICY IF EXISTS "sacco_member_requests_same_org" ON public.sacco_member_requests;
DROP POLICY IF EXISTS "sacco_member_requests_staff" ON public.sacco_member_requests;
DROP POLICY IF EXISTS "sacco_member_requests_member" ON public.sacco_member_requests;
CREATE POLICY "sacco_member_requests_staff" ON public.sacco_member_requests
  FOR ALL TO authenticated
  USING (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
  WITH CHECK (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));
CREATE POLICY "sacco_member_requests_member" ON public.sacco_member_requests
  FOR ALL TO authenticated
  USING (sacco_member_id = public.current_sacco_member_id())
  WITH CHECK (
    sacco_member_id = public.current_sacco_member_id()
    AND organization_id = public.current_sacco_member_org_id()
    AND status = 'pending'
  );

GRANT SELECT ON public.sacco_member_app_users TO authenticated;
GRANT INSERT, UPDATE ON public.sacco_member_app_users TO authenticated;

CREATE OR REPLACE FUNCTION public.set_sacco_member_loan_org()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.organization_id IS NULL AND public.current_sacco_member_id() = NEW.sacco_member_id THEN
    NEW.organization_id := public.current_sacco_member_org_id();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_set_sacco_member_loan_org ON public.sacco_loans;
CREATE TRIGGER zz_set_sacco_member_loan_org
BEFORE INSERT ON public.sacco_loans
FOR EACH ROW EXECUTE FUNCTION public.set_sacco_member_loan_org();
