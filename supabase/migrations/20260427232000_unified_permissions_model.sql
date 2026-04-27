-- Unified permissions model:
-- - Role-based grants per organization.
-- - Staff-specific overrides (allow/deny) per organization.
-- This merges legacy "approval rights" and operational edit permissions.

CREATE TABLE IF NOT EXISTS public.organization_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role_key text NOT NULL,
  permission_key text NOT NULL,
  allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_permissions_org_role_perm_uq UNIQUE (organization_id, role_key, permission_key)
);

CREATE TABLE IF NOT EXISTS public.staff_permission_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  allowed boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_permission_overrides_org_staff_perm_uq UNIQUE (organization_id, staff_id, permission_key)
);

CREATE INDEX IF NOT EXISTS idx_org_permissions_org ON public.organization_permissions (organization_id, role_key);
CREATE INDEX IF NOT EXISTS idx_staff_permission_overrides_org ON public.staff_permission_overrides (organization_id, staff_id);

CREATE OR REPLACE FUNCTION public.touch_permissions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_org_permissions_touch ON public.organization_permissions;
CREATE TRIGGER trg_org_permissions_touch
BEFORE UPDATE ON public.organization_permissions
FOR EACH ROW
EXECUTE FUNCTION public.touch_permissions_updated_at();

DROP TRIGGER IF EXISTS trg_staff_permission_overrides_touch ON public.staff_permission_overrides;
CREATE TRIGGER trg_staff_permission_overrides_touch
BEFORE UPDATE ON public.staff_permission_overrides
FOR EACH ROW
EXECUTE FUNCTION public.touch_permissions_updated_at();

DROP TRIGGER IF EXISTS trg_set_org_org_permissions ON public.organization_permissions;
CREATE TRIGGER trg_set_org_org_permissions
BEFORE INSERT ON public.organization_permissions
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_staff_permission_overrides ON public.staff_permission_overrides;
CREATE TRIGGER trg_set_org_staff_permission_overrides
BEFORE INSERT ON public.staff_permission_overrides
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

ALTER TABLE public.organization_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_permission_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "organization_permissions_select_same_org"
  ON public.organization_permissions FOR SELECT
  TO authenticated
  USING (
    public.is_platform_admin()
    OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
  );

CREATE POLICY "organization_permissions_manage_admin"
  ON public.organization_permissions FOR ALL
  TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
      AND EXISTS (
        SELECT 1 FROM public.staff me
        WHERE me.id = auth.uid()
          AND me.role = 'admin'
      )
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (
      organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
      AND EXISTS (
        SELECT 1 FROM public.staff me
        WHERE me.id = auth.uid()
          AND me.role = 'admin'
      )
    )
  );

CREATE POLICY "staff_permission_overrides_select_same_org"
  ON public.staff_permission_overrides FOR SELECT
  TO authenticated
  USING (
    public.is_platform_admin()
    OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
  );

CREATE POLICY "staff_permission_overrides_manage_admin"
  ON public.staff_permission_overrides FOR ALL
  TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
      AND EXISTS (
        SELECT 1 FROM public.staff me
        WHERE me.id = auth.uid()
          AND me.role = 'admin'
      )
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (
      organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
      AND EXISTS (
        SELECT 1 FROM public.staff me
        WHERE me.id = auth.uid()
          AND me.role = 'admin'
      )
    )
  );

-- Seed baseline role permissions to preserve current behavior.
WITH permission_keys(permission_key) AS (
  VALUES
    ('purchase_orders'),
    ('bills'),
    ('vendor_credits'),
    ('chart_of_accounts'),
    ('sacco_savings_settings'),
    ('payroll_prepare'),
    ('payroll_approve'),
    ('payroll_post'),
    ('pos_orders_edit'),
    ('cash_receipts_edit')
)
INSERT INTO public.organization_permissions (organization_id, role_key, permission_key, allowed)
SELECT
  ort.organization_id,
  ort.role_key,
  pk.permission_key,
  CASE
    WHEN pk.permission_key = 'purchase_orders' THEN ort.role_key IN ('admin', 'manager')
    WHEN pk.permission_key = 'bills' THEN ort.role_key IN ('admin', 'manager', 'accountant')
    WHEN pk.permission_key = 'vendor_credits' THEN ort.role_key IN ('admin', 'manager')
    WHEN pk.permission_key = 'chart_of_accounts' THEN ort.role_key IN ('admin', 'manager')
    WHEN pk.permission_key = 'sacco_savings_settings' THEN ort.role_key IN ('admin', 'manager')
    WHEN pk.permission_key = 'payroll_prepare' THEN ort.role_key IN ('admin', 'manager', 'accountant')
    WHEN pk.permission_key = 'payroll_approve' THEN ort.role_key IN ('admin', 'manager')
    WHEN pk.permission_key = 'payroll_post' THEN ort.role_key IN ('admin', 'accountant')
    WHEN pk.permission_key = 'pos_orders_edit' THEN ort.can_edit_pos_orders = true OR ort.role_key IN ('admin', 'manager', 'accountant', 'supervisor')
    WHEN pk.permission_key = 'cash_receipts_edit' THEN ort.can_edit_cash_receipts = true OR ort.role_key IN ('admin', 'manager', 'accountant', 'supervisor')
    ELSE false
  END AS allowed
FROM public.organization_role_types ort
CROSS JOIN permission_keys pk
ON CONFLICT (organization_id, role_key, permission_key) DO NOTHING;
