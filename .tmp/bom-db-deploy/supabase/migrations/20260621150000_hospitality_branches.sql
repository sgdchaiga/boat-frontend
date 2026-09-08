-- Multi-branch hospitality: staff and orders scoped so branch A staff cannot see branch B sales.

CREATE TABLE IF NOT EXISTS public.hospitality_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hospitality_branches_org_code UNIQUE (organization_id, code),
  CONSTRAINT hospitality_branches_code_format CHECK (code ~ '^[a-z0-9_]+$')
);

CREATE INDEX IF NOT EXISTS idx_hospitality_branches_org ON public.hospitality_branches (organization_id);

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS hospitality_branch_id uuid REFERENCES public.hospitality_branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_staff_hospitality_branch ON public.staff (hospitality_branch_id);

ALTER TABLE public.kitchen_orders
  ADD COLUMN IF NOT EXISTS hospitality_branch_id uuid REFERENCES public.hospitality_branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_kitchen_orders_hospitality_branch ON public.kitchen_orders (hospitality_branch_id);

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS hospitality_branch_id uuid REFERENCES public.hospitality_branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payments_hospitality_branch ON public.payments (hospitality_branch_id);

ALTER TABLE public.hospitality_branches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hospitality_branches_org" ON public.hospitality_branches;
CREATE POLICY "hospitality_branches_org"
  ON public.hospitality_branches FOR ALL TO authenticated
  USING (
    organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = (SELECT auth.uid()))
    OR public.is_platform_admin()
  )
  WITH CHECK (
    organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = (SELECT auth.uid()))
    OR public.is_platform_admin()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hospitality_branches TO authenticated;

COMMENT ON TABLE public.hospitality_branches IS 'Hotel/restaurant outlets; staff.hospitality_branch_id limits POS and order visibility.';

-- Default branch per hospitality org (existing rows stay org-wide until staff are assigned).
INSERT INTO public.hospitality_branches (organization_id, code, name, sort_order)
SELECT o.id, 'main', 'Main branch', 0
FROM public.organizations o
WHERE o.business_type IN ('hotel', 'mixed', 'restaurant')
  AND NOT EXISTS (
    SELECT 1 FROM public.hospitality_branches b WHERE b.organization_id = o.id
  );

-- Role types for operational menus (role_key drives sidebar allow-list in the app).
INSERT INTO public.organization_role_types (organization_id, role_key, display_name, sort_order)
SELECT o.id, v.role_key, v.display_name, v.sort_order
FROM public.organizations o
CROSS JOIN (
  VALUES
    ('waitress', 'Waitress', 6),
    ('bartender', 'Bartender', 7),
    ('kitchen', 'Kitchen staff', 8)
) AS v(role_key, display_name, sort_order)
WHERE o.business_type IN ('hotel', 'mixed', 'restaurant')
ON CONFLICT (organization_id, role_key) DO NOTHING;
