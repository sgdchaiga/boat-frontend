-- Per-organization staff role keys; staff.role stores role_key (text).

CREATE TABLE IF NOT EXISTS public.organization_role_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role_key text NOT NULL,
  display_name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_role_types_org_key UNIQUE (organization_id, role_key),
  CONSTRAINT organization_role_types_role_key_format CHECK (role_key ~ '^[a-z0-9_]+$')
);

CREATE INDEX IF NOT EXISTS idx_organization_role_types_org ON public.organization_role_types (organization_id);

ALTER TABLE public.staff DROP CONSTRAINT IF EXISTS staff_role_check;

ALTER TABLE public.organization_role_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_role_types_select_same_org"
  ON public.organization_role_types FOR SELECT
  TO authenticated
  USING (
    organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = (select auth.uid()))
    OR public.is_platform_admin()
  );

CREATE POLICY "org_role_types_insert_admin"
  ON public.organization_role_types FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (
      EXISTS (
        SELECT 1 FROM public.staff me
        WHERE me.id = (select auth.uid())
          AND me.role = 'admin'
          AND me.organization_id IS NOT NULL
          AND me.organization_id = organization_role_types.organization_id
      )
    )
  );

CREATE POLICY "org_role_types_update_admin"
  ON public.organization_role_types FOR UPDATE
  TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      EXISTS (
        SELECT 1 FROM public.staff me
        WHERE me.id = (select auth.uid())
          AND me.role = 'admin'
          AND me.organization_id IS NOT NULL
          AND me.organization_id = organization_role_types.organization_id
      )
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (
      EXISTS (
        SELECT 1 FROM public.staff me
        WHERE me.id = (select auth.uid())
          AND me.role = 'admin'
          AND me.organization_id IS NOT NULL
          AND me.organization_id = organization_role_types.organization_id
      )
    )
  );

CREATE POLICY "org_role_types_delete_admin"
  ON public.organization_role_types FOR DELETE
  TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      EXISTS (
        SELECT 1 FROM public.staff me
        WHERE me.id = (select auth.uid())
          AND me.role = 'admin'
          AND me.organization_id IS NOT NULL
          AND me.organization_id = organization_role_types.organization_id
      )
    )
  );

INSERT INTO public.organization_role_types (organization_id, role_key, display_name, sort_order)
SELECT o.id, v.role_key, v.display_name, v.sort_order
FROM public.organizations o
CROSS JOIN (
  VALUES
    ('admin', 'Administrator', 0),
    ('manager', 'Manager', 1),
    ('receptionist', 'Receptionist', 2),
    ('housekeeping', 'Housekeeping', 3),
    ('accountant', 'Accountant', 4),
    ('barman', 'Barman', 5)
) AS v(role_key, display_name, sort_order)
ON CONFLICT (organization_id, role_key) DO NOTHING;

COMMENT ON TABLE public.organization_role_types IS 'Org-defined role keys; staff.role must match a role_key for that organization.';
