-- Personnel can participate in payroll without becoming authentication users.
-- Existing login staff retain the same id and auth-user delete cascade.
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS is_payroll_only boolean NOT NULL DEFAULT false;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS login_user_id uuid
  GENERATED ALWAYS AS (CASE WHEN is_payroll_only THEN NULL::uuid ELSE id END) STORED;
ALTER TABLE public.staff ADD CONSTRAINT staff_login_user_id_fkey
  FOREIGN KEY (login_user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
-- Preserve legacy imported personnel without auth records. The constraint still
-- enforces the login link for new records and cascades deletions of linked users.
ALTER TABLE public.staff ADD CONSTRAINT staff_payroll_only_no_login_check
  CHECK (NOT is_payroll_only OR (is_active = false AND role = 'payroll_employee'));

DO $$
DECLARE fk record;
BEGIN
  FOR fk IN SELECT c.conname FROM pg_constraint c
    WHERE c.conrelid = 'public.staff'::regclass AND c.confrelid = 'auth.users'::regclass
      AND c.contype = 'f' AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.staff'::regclass AND attname = 'id')]::smallint[]
  LOOP EXECUTE format('ALTER TABLE public.staff DROP CONSTRAINT %I', fk.conname); END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_payroll_employee(
  p_full_name text, p_employee_code text, p_department text DEFAULT NULL,
  p_job_title text DEFAULT NULL, p_staff_type text DEFAULT NULL,
  p_date_joined date DEFAULT NULL, p_email text DEFAULT NULL, p_phone text DEFAULT NULL,
  p_base_salary numeric DEFAULT 0
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor public.staff%ROWTYPE; oid uuid; permission_value boolean; new_id uuid := gen_random_uuid(); bt text;
BEGIN
  SELECT * INTO actor FROM public.staff WHERE id = auth.uid() AND is_active = true;
  oid := public.auth_organization_id();
  IF actor.id IS NULL OR oid IS NULL OR actor.organization_id IS DISTINCT FROM oid THEN
    RAISE EXCEPTION 'An active organization login is required';
  END IF;
  SELECT business_type INTO bt FROM public.organizations WHERE id = oid AND enable_payroll IS NOT FALSE;
  IF bt IS NULL THEN RAISE EXCEPTION 'Payroll is not enabled for this organization'; END IF;
  SELECT allowed INTO permission_value FROM public.staff_permission_overrides
    WHERE organization_id = oid AND staff_id = actor.id AND permission_key = 'payroll_prepare';
  IF permission_value IS NULL THEN
    SELECT allowed INTO permission_value FROM public.organization_permissions
      WHERE organization_id = oid AND role_key = actor.role AND permission_key = 'payroll_prepare';
  END IF;
  IF NOT coalesce(permission_value, actor.role IN ('admin', 'manager', 'accountant', 'super_admin')) THEN
    RAISE EXCEPTION 'Payroll prepare permission is required';
  END IF;
  IF nullif(trim(p_full_name), '') IS NULL OR nullif(trim(p_employee_code), '') IS NULL THEN
    RAISE EXCEPTION 'Full name and employee code are required';
  END IF;
  IF p_base_salary IS NULL OR p_base_salary < 0 OR p_base_salary::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'Base salary must be zero or greater';
  END IF;
  IF nullif(trim(p_staff_type), '') IS NOT NULL AND NOT (
    (bt = 'school' AND p_staff_type IN ('Teaching', 'Non-Teaching')) OR
    (bt = 'manufacturing' AND p_staff_type IN ('Production', 'Maintenance', 'Quality Control', 'Warehouse & Logistics', 'Administration', 'Sales & Distribution')) OR
    (bt NOT IN ('school', 'manufacturing') AND p_staff_type IN ('Operations', 'Administration', 'Sales', 'Support'))
  ) THEN RAISE EXCEPTION 'Select a staff type for this business'; END IF;
  -- Serialize employee-code checks within the organization to reject concurrent duplicates.
  PERFORM 1 FROM public.organizations WHERE id = oid FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.payroll_employee_profiles WHERE organization_id = oid AND lower(trim(employee_code)) = lower(trim(p_employee_code))) THEN
    RAISE EXCEPTION 'Employee code already exists in this organization';
  END IF;
  INSERT INTO public.staff(id, full_name, email, phone, role, is_active, organization_id, is_payroll_only)
  VALUES (new_id, trim(p_full_name), coalesce(nullif(trim(p_email), ''), ''), nullif(trim(p_phone), ''), 'payroll_employee', false, oid, true);
  INSERT INTO public.payroll_employee_profiles(organization_id, staff_id, employee_code, department, job_title, staff_type, date_joined, base_salary, is_on_payroll)
  VALUES (oid, new_id, trim(p_employee_code), nullif(trim(p_department), ''), nullif(trim(p_job_title), ''), nullif(trim(p_staff_type), ''), p_date_joined, p_base_salary, true);
  INSERT INTO public.payroll_audit_log(organization_id, actor_staff_id, action, details)
  VALUES (oid, actor.id, 'employee_created', jsonb_build_object('staff_id', new_id, 'payroll_only', true));
  RETURN new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_payroll_employee(text,text,text,text,text,date,text,text,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_payroll_employee(text,text,text,text,text,date,text,text,numeric) TO authenticated;
