-- Platform super users, organizations, and subscriptions

-- 1) Organizations (tenants)
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE,
  business_type text NOT NULL DEFAULT 'hotel',
  enable_front_desk boolean NOT NULL DEFAULT true,
  enable_billing boolean NOT NULL DEFAULT true,
  enable_pos boolean NOT NULL DEFAULT true,
  enable_inventory boolean NOT NULL DEFAULT true,
  enable_purchases boolean NOT NULL DEFAULT true,
  enable_accounting boolean NOT NULL DEFAULT true,
  enable_reports boolean NOT NULL DEFAULT true,
  enable_admin boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2) Subscription plans
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  price_monthly numeric(12,2) NOT NULL DEFAULT 0,
  price_yearly numeric(12,2) NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3) Organization subscription instances
CREATE TABLE IF NOT EXISTS public.organization_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial', 'active', 'past_due', 'cancelled', 'expired')),
  period_start date NOT NULL DEFAULT CURRENT_DATE,
  period_end date,
  external_ref text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_subscriptions_org ON public.organization_subscriptions(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_subscriptions_status ON public.organization_subscriptions(status);

-- 4) Platform super users (full system control)
CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  label text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 5) Link staff to organization (nullable until backfill)
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

-- 5b) organizations may already exist from an older schema (no slug, etc.)
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS business_type text;
UPDATE public.organizations SET business_type = 'hotel' WHERE business_type IS NULL;
ALTER TABLE public.organizations ALTER COLUMN business_type SET DEFAULT 'hotel';
ALTER TABLE public.organizations ALTER COLUMN business_type SET NOT NULL;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS enable_front_desk boolean NOT NULL DEFAULT true;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS enable_billing boolean NOT NULL DEFAULT true;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS enable_pos boolean NOT NULL DEFAULT true;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS enable_inventory boolean NOT NULL DEFAULT true;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS enable_purchases boolean NOT NULL DEFAULT true;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS enable_accounting boolean NOT NULL DEFAULT true;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS enable_reports boolean NOT NULL DEFAULT true;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS enable_admin boolean NOT NULL DEFAULT true;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS organizations_slug_unique ON public.organizations (slug) WHERE slug IS NOT NULL;

-- Seed default organization + plans
INSERT INTO public.organizations (name, slug, business_type)
SELECT 'Default property', 'default', 'hotel'
WHERE NOT EXISTS (SELECT 1 FROM public.organizations WHERE slug = 'default');

UPDATE public.staff
SET organization_id = (SELECT id FROM public.organizations WHERE slug = 'default' LIMIT 1)
WHERE organization_id IS NULL
  AND EXISTS (SELECT 1 FROM public.organizations WHERE slug = 'default');

-- 5c) subscription_plans may already exist without code, etc.
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS price_monthly numeric(12,2);
UPDATE public.subscription_plans SET price_monthly = 0 WHERE price_monthly IS NULL;
ALTER TABLE public.subscription_plans ALTER COLUMN price_monthly SET DEFAULT 0;
ALTER TABLE public.subscription_plans ALTER COLUMN price_monthly SET NOT NULL;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS price_yearly numeric(12,2);
UPDATE public.subscription_plans
SET price_yearly = ROUND((COALESCE(price_monthly, 0) * 12)::numeric, 2)
WHERE price_yearly IS NULL;
UPDATE public.subscription_plans SET price_yearly = 0 WHERE price_yearly IS NULL;
ALTER TABLE public.subscription_plans ALTER COLUMN price_yearly SET DEFAULT 0;
ALTER TABLE public.subscription_plans ALTER COLUMN price_yearly SET NOT NULL;
UPDATE public.subscription_plans
SET code = 'plan_' || replace(id::text, '-', '')
WHERE code IS NULL OR trim(code) = '';
ALTER TABLE public.subscription_plans ALTER COLUMN code SET NOT NULL;
DO $cq$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.subscription_plans'::regclass
      AND conname = 'subscription_plans_code_uq'
  ) THEN
    ALTER TABLE public.subscription_plans ADD CONSTRAINT subscription_plans_code_uq UNIQUE (code);
  END IF;
END
$cq$;

INSERT INTO public.subscription_plans (code, name, description, price_monthly, price_yearly, sort_order)
VALUES
  ('starter', 'Starter', 'Core front desk & billing', 49.00, 588.00, 1),
  ('professional', 'Professional', 'POS, inventory, purchases', 129.00, 1548.00, 2),
  ('enterprise', 'Enterprise', 'Full accounting & reports', 249.00, 2988.00, 3)
ON CONFLICT (code) DO NOTHING;

-- Default org on starter trial if none
INSERT INTO public.organization_subscriptions (organization_id, plan_id, status, period_start, period_end)
SELECT o.id, p.id, 'active', CURRENT_DATE, CURRENT_DATE + interval '365 days'
FROM public.organizations o
CROSS JOIN public.subscription_plans p
WHERE o.slug = 'default' AND p.code = 'professional'
  AND NOT EXISTS (
    SELECT 1 FROM public.organization_subscriptions s WHERE s.organization_id = o.id
  );

-- Helper: platform admin check (bypasses RLS on platform_admins)
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins pa
    WHERE pa.user_id = (select auth.uid())
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

-- Platform admins: full CRUD on organizations
CREATE POLICY "platform_admin_organizations_all"
  ON public.organizations FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- Staff can read their own organization (for future module gating)
CREATE POLICY "staff_read_own_organization"
  ON public.organizations FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = (select auth.uid()) AND s.organization_id = organizations.id
    )
  );

CREATE POLICY "platform_admin_plans_all"
  ON public.subscription_plans FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

CREATE POLICY "authenticated_read_plans"
  ON public.subscription_plans FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "platform_admin_org_subscriptions_all"
  ON public.organization_subscriptions FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

CREATE POLICY "staff_read_own_org_subscription"
  ON public.organization_subscriptions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = (select auth.uid()) AND s.organization_id = organization_subscriptions.organization_id
    )
  );

-- platform_admins: each user can see own row; platform admins see all
CREATE POLICY "platform_admins_select"
  ON public.platform_admins FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()) OR public.is_platform_admin());

CREATE POLICY "platform_admins_insert"
  ON public.platform_admins FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());

CREATE POLICY "platform_admins_delete"
  ON public.platform_admins FOR DELETE TO authenticated
  USING (public.is_platform_admin());

COMMENT ON TABLE public.platform_admins IS 'Super users: promote via INSERT (first user via SQL Editor as postgres). Example: INSERT INTO platform_admins (user_id) VALUES (''<auth user uuid>'');';
