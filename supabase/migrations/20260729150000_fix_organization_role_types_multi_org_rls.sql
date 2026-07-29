-- The original role-type policies only recognized legacy public.staff rows.
-- Cloud organization admins authenticate through organization_members, so use
-- the shared SECURITY DEFINER authorization helper that supports both models.
ALTER TABLE public.organization_role_types ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.caller_can_manage_org_role_types(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_org_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND (
      public.is_platform_admin()
      OR EXISTS (
        SELECT 1
        FROM public.organization_members om
        WHERE om.user_id = auth.uid()
          AND om.organization_id = p_org_id
          AND om.is_active = true
          AND om.role IN ('owner', 'super_admin', 'admin', 'manager')
      )
      OR EXISTS (
        SELECT 1
        FROM public.staff s
        WHERE s.id = auth.uid()
          AND s.organization_id = p_org_id
          AND s.is_active = true
          AND s.role IN ('owner', 'super_admin', 'admin', 'manager')
      )
    );
$$;

REVOKE ALL ON FUNCTION public.caller_can_manage_org_role_types(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caller_can_manage_org_role_types(uuid) TO authenticated;

DROP POLICY IF EXISTS "org_role_types_select_same_org" ON public.organization_role_types;
DROP POLICY IF EXISTS "org_role_types_insert_admin" ON public.organization_role_types;
DROP POLICY IF EXISTS "org_role_types_update_admin" ON public.organization_role_types;
DROP POLICY IF EXISTS "org_role_types_delete_admin" ON public.organization_role_types;

CREATE POLICY "org_role_types_select_same_org"
  ON public.organization_role_types
  FOR SELECT TO authenticated
  USING (
    public.is_platform_admin()
    OR public.user_is_member_of_org(organization_id)
    OR EXISTS (
      SELECT 1
      FROM public.staff s
      WHERE s.id = auth.uid()
        AND s.organization_id = organization_role_types.organization_id
        AND s.is_active = true
    )
  );

CREATE POLICY "org_role_types_insert_admin"
  ON public.organization_role_types
  FOR INSERT TO authenticated
  WITH CHECK (
    public.caller_can_manage_org_role_types(organization_id)
  );

CREATE POLICY "org_role_types_update_admin"
  ON public.organization_role_types
  FOR UPDATE TO authenticated
  USING (
    public.caller_can_manage_org_role_types(organization_id)
  )
  WITH CHECK (
    public.caller_can_manage_org_role_types(organization_id)
  );

CREATE POLICY "org_role_types_delete_admin"
  ON public.organization_role_types
  FOR DELETE TO authenticated
  USING (
    public.caller_can_manage_org_role_types(organization_id)
  );

-- Repair organizations whose role catalogue was never fully seeded. Existing
-- custom roles are preserved and no role is overwritten.
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
  defaults.role_key,
  defaults.display_name,
  defaults.sort_order,
  defaults.can_edit_pos_orders,
  defaults.can_edit_cash_receipts
FROM public.organizations o
CROSS JOIN (
  VALUES
    ('owner', 'Owner', 0, false, false),
    ('admin', 'Administrator', 5, false, false),
    ('manager', 'Manager', 10, false, false),
    ('accountant', 'Accountant', 20, false, false),
    ('cashier', 'Cashier / Salesperson', 30, false, false),
    ('storekeeper', 'Storekeeper', 40, false, false),
    ('purchasing_officer', 'Purchasing Officer', 50, false, false),
    ('viewer', 'Viewer', 60, false, false),
    ('supervisor', 'Supervisor', 70, false, false)
) AS defaults(role_key, display_name, sort_order, can_edit_pos_orders, can_edit_cash_receipts)
ON CONFLICT (organization_id, role_key) DO NOTHING;
