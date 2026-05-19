-- Allow unlimited concurrent teller tills: one open session per staff member per org (not per org total).
-- Fixes mistaken org-wide unique indexes that block a 3rd teller from opening a till.

-- Remove incorrect org-wide caps if they were added manually or from an old script.
DROP INDEX IF EXISTS public.sacco_teller_sess_one_open_per_org;
DROP INDEX IF EXISTS public.sacco_teller_one_open_per_org;
DROP INDEX IF EXISTS public.idx_sacco_teller_one_open_per_org;
DROP INDEX IF EXISTS public.sacco_teller_sessions_one_open_per_org;

DROP INDEX IF EXISTS public.sacco_teller_sess_one_open_per_staff;

CREATE UNIQUE INDEX sacco_teller_sess_one_open_per_staff
  ON public.sacco_teller_sessions (organization_id, staff_id)
  WHERE (status = 'open');

COMMENT ON INDEX public.sacco_teller_sess_one_open_per_staff IS
  'Each staff member may have at most one open till per organization; any number of staff may be open at once.';

-- Supervisors may close another teller''s till; each teller may only open a session for themselves.
CREATE OR REPLACE FUNCTION public.auth_staff_is_org_supervisor()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff s
    WHERE s.id = auth.uid()
      AND lower(coalesce(s.role::text, '')) IN (
        'admin',
        'manager',
        'accountant',
        'supervisor',
        'owner'
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.auth_staff_is_org_supervisor() TO authenticated;

DROP POLICY IF EXISTS "sacco_teller_sess_org" ON public.sacco_teller_sessions;

CREATE POLICY "sacco_teller_sess_select"
  ON public.sacco_teller_sessions
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_admin()
    OR organization_id = public.auth_staff_org_id()
  );

CREATE POLICY "sacco_teller_sess_insert"
  ON public.sacco_teller_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (
      organization_id = public.auth_staff_org_id()
      AND staff_id = auth.uid()
    )
  );

CREATE POLICY "sacco_teller_sess_update"
  ON public.sacco_teller_sessions
  FOR UPDATE
  TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      organization_id = public.auth_staff_org_id()
      AND (
        staff_id = auth.uid()
        OR public.auth_staff_is_org_supervisor()
      )
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (
      organization_id = public.auth_staff_org_id()
      AND (
        staff_id = auth.uid()
        OR public.auth_staff_is_org_supervisor()
      )
    )
  );

CREATE POLICY "sacco_teller_sess_delete"
  ON public.sacco_teller_sessions
  FOR DELETE
  TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      organization_id = public.auth_staff_org_id()
      AND (
        staff_id = auth.uid()
        OR public.auth_staff_is_org_supervisor()
      )
    )
  );

COMMENT ON TABLE public.sacco_teller_sessions IS
  'Per-staff till session. Many tellers may have open sessions at once; each staff member has at most one open session per org.';
