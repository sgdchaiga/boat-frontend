CREATE TABLE IF NOT EXISTS public.sacco_member_app_users (
  auth_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sacco_member_id uuid NOT NULL REFERENCES public.sacco_members(id) ON DELETE CASCADE,
  login_email text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'suspended', 'revoked')),
  invited_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  invited_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  must_change_password boolean NOT NULL DEFAULT true,
  UNIQUE (organization_id, sacco_member_id)
);

CREATE INDEX IF NOT EXISTS idx_sacco_member_app_users_member
  ON public.sacco_member_app_users(organization_id, sacco_member_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sacco_member_app_users_org_email
  ON public.sacco_member_app_users(organization_id, lower(login_email));

ALTER TABLE public.sacco_member_app_users ENABLE ROW LEVEL SECURITY;

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

CREATE POLICY "sacco_members_member_self" ON public.sacco_members
  FOR SELECT TO authenticated USING (id = public.current_sacco_member_id());
CREATE POLICY "sacco_savings_member_self" ON public.sacco_member_savings_accounts
  FOR SELECT TO authenticated USING (sacco_member_id = public.current_sacco_member_id());
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
CREATE POLICY "sacco_fd_member_self" ON public.sacco_fixed_deposits
  FOR SELECT TO authenticated USING (sacco_member_id = public.current_sacco_member_id());
CREATE POLICY "sacco_cashbook_member_self" ON public.sacco_cashbook_entries
  FOR SELECT TO authenticated USING (sacco_member_id = public.current_sacco_member_id());
CREATE POLICY "sacco_loan_products_member_read" ON public.sacco_loan_products
  FOR SELECT TO authenticated USING (organization_id = public.current_sacco_member_org_id());

DROP POLICY IF EXISTS "sacco_member_requests_same_org" ON public.sacco_member_requests;
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
