-- Organization-level Super Admin role.
-- Platform superusers can assign the first org super admin; after that, only
-- an existing org super admin can assign/remove that role or grant sensitive rights.

INSERT INTO public.organization_role_types (
  organization_id,
  role_key,
  display_name,
  sort_order,
  can_edit_pos_orders,
  can_edit_cash_receipts
)
SELECT
  o.id,
  'super_admin',
  'Super Admin',
  -10,
  true,
  true
FROM public.organizations o
ON CONFLICT (organization_id, role_key) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  sort_order = LEAST(public.organization_role_types.sort_order, EXCLUDED.sort_order),
  can_edit_pos_orders = true,
  can_edit_cash_receipts = true;

CREATE OR REPLACE FUNCTION public.caller_is_org_super_admin_for(p_org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_org_id IS NULL THEN
    RETURN false;
  END IF;
  IF public.is_platform_admin() THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.user_id = auth.uid()
      AND om.organization_id = p_org_id
      AND om.is_active = true
      AND om.role = 'super_admin'
  ) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.staff s
    WHERE s.id = auth.uid()
      AND s.organization_id = p_org_id
      AND s.is_active = true
      AND s.role = 'super_admin'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.permission_key_is_sensitive(p_permission_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_permission_key IN (
    'purchase_orders',
    'bills',
    'vendor_credits',
    'chart_of_accounts',
    'sacco_savings_settings',
    'sacco_transaction_edit',
    'payroll_prepare',
    'payroll_approve',
    'payroll_post',
    'pos_orders_edit',
    'cash_receipts_edit',
    'stock_adjustments_delete'
  );
$$;

CREATE OR REPLACE FUNCTION public.protect_org_super_admin_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.role = 'super_admin'
      AND NOT public.caller_is_org_super_admin_for(NEW.organization_id)
    THEN
      RAISE EXCEPTION 'Only a super admin can assign the super_admin role.';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.role IS DISTINCT FROM OLD.role
      AND (NEW.role = 'super_admin' OR OLD.role = 'super_admin')
      AND NOT public.caller_is_org_super_admin_for(COALESCE(NEW.organization_id, OLD.organization_id))
    THEN
      RAISE EXCEPTION 'Only a super admin can assign or remove the super_admin role.';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_org_role_type_sensitive_rights()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role_key = 'super_admin'
      AND NOT public.caller_is_org_super_admin_for(OLD.organization_id)
    THEN
      RAISE EXCEPTION 'Only a super admin can remove the super_admin role type.';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF (NEW.role_key = 'super_admin' OR NEW.can_edit_pos_orders = true OR NEW.can_edit_cash_receipts = true)
      AND NOT public.caller_is_org_super_admin_for(NEW.organization_id)
    THEN
      RAISE EXCEPTION 'Only a super admin can create protected roles or grant sensitive edit rights.';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (
        NEW.role_key = 'super_admin'
        OR OLD.role_key = 'super_admin'
        OR NEW.can_edit_pos_orders IS DISTINCT FROM OLD.can_edit_pos_orders
        OR NEW.can_edit_cash_receipts IS DISTINCT FROM OLD.can_edit_cash_receipts
      )
      AND NOT public.caller_is_org_super_admin_for(COALESCE(NEW.organization_id, OLD.organization_id))
    THEN
      RAISE EXCEPTION 'Only a super admin can change protected roles or sensitive edit rights.';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_staff_super_admin_role ON public.staff;
CREATE TRIGGER trg_protect_staff_super_admin_role
BEFORE INSERT OR UPDATE OF role, organization_id ON public.staff
FOR EACH ROW
EXECUTE FUNCTION public.protect_org_super_admin_role();

DROP TRIGGER IF EXISTS trg_protect_org_member_super_admin_role ON public.organization_members;
CREATE TRIGGER trg_protect_org_member_super_admin_role
BEFORE INSERT OR UPDATE OF role, organization_id ON public.organization_members
FOR EACH ROW
EXECUTE FUNCTION public.protect_org_super_admin_role();

DROP TRIGGER IF EXISTS trg_protect_org_role_type_sensitive_rights ON public.organization_role_types;
CREATE TRIGGER trg_protect_org_role_type_sensitive_rights
BEFORE INSERT OR UPDATE OR DELETE ON public.organization_role_types
FOR EACH ROW
EXECUTE FUNCTION public.protect_org_role_type_sensitive_rights();

DROP POLICY IF EXISTS "organization_permissions_manage_admin" ON public.organization_permissions;
CREATE POLICY "organization_permissions_manage_super_admin"
  ON public.organization_permissions FOR ALL
  TO authenticated
  USING (
    public.is_platform_admin()
    OR public.caller_is_org_super_admin_for(organization_id)
  )
  WITH CHECK (
    public.is_platform_admin()
    OR public.caller_is_org_super_admin_for(organization_id)
  );

DROP POLICY IF EXISTS "staff_permission_overrides_manage_admin" ON public.staff_permission_overrides;
CREATE POLICY "staff_permission_overrides_manage_admin"
  ON public.staff_permission_overrides FOR ALL
  TO authenticated
  USING (
    public.is_platform_admin()
    OR public.caller_is_org_super_admin_for(organization_id)
    OR (
      organization_id = public.auth_organization_id()
      AND NOT public.permission_key_is_sensitive(permission_key)
      AND permission_key NOT LIKE 'page:reports%'
      AND permission_key <> 'page:hotel_pos_reports'
      AND permission_key <> 'page:retail_credit_sales_report'
      AND permission_key <> 'page:accounting_trial'
      AND permission_key <> 'page:accounting_income'
      AND permission_key <> 'page:accounting_balance'
      AND permission_key <> 'page:accounting_cashflow'
      AND public.caller_is_org_admin_for(organization_id)
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR public.caller_is_org_super_admin_for(organization_id)
    OR (
      organization_id = public.auth_organization_id()
      AND NOT public.permission_key_is_sensitive(permission_key)
      AND permission_key NOT LIKE 'page:reports%'
      AND permission_key <> 'page:hotel_pos_reports'
      AND permission_key <> 'page:retail_credit_sales_report'
      AND permission_key <> 'page:accounting_trial'
      AND permission_key <> 'page:accounting_income'
      AND permission_key <> 'page:accounting_balance'
      AND permission_key <> 'page:accounting_cashflow'
      AND public.caller_is_org_admin_for(organization_id)
    )
  );

INSERT INTO public.organization_permissions (organization_id, role_key, permission_key, allowed)
SELECT ort.organization_id, ort.role_key, pk.permission_key, true
FROM public.organization_role_types ort
CROSS JOIN (
  VALUES
    ('purchase_orders'),
    ('bills'),
    ('vendor_credits'),
    ('chart_of_accounts'),
    ('sacco_savings_settings'),
    ('sacco_transaction_edit'),
    ('payroll_prepare'),
    ('payroll_approve'),
    ('payroll_post'),
    ('pos_orders_edit'),
    ('cash_receipts_edit'),
    ('stock_adjustments_delete')
) AS pk(permission_key)
WHERE ort.role_key = 'super_admin'
ON CONFLICT (organization_id, role_key, permission_key) DO UPDATE
SET allowed = true;

REVOKE ALL ON FUNCTION public.caller_is_org_super_admin_for(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.permission_key_is_sensitive(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caller_is_org_super_admin_for(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.permission_key_is_sensitive(text) TO authenticated;

COMMENT ON FUNCTION public.caller_is_org_super_admin_for(uuid) IS
  'True for platform admins or active organization staff/members with the super_admin role.';
