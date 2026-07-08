ALTER TABLE public.cost_allocation_rules
  ALTER COLUMN target_cost_centre_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS public.cost_allocation_rule_centres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES public.cost_allocation_rules(id) ON DELETE CASCADE,
  cost_centre_id uuid NOT NULL REFERENCES public.cost_allocation_centres(id) ON DELETE CASCADE,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, rule_id, cost_centre_id)
);

INSERT INTO public.cost_allocation_rule_centres (organization_id, rule_id, cost_centre_id, is_enabled)
SELECT organization_id, id, target_cost_centre_id, true
FROM public.cost_allocation_rules
WHERE target_cost_centre_id IS NOT NULL
ON CONFLICT (organization_id, rule_id, cost_centre_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_cost_allocation_rule_centres_org_rule
  ON public.cost_allocation_rule_centres (organization_id, rule_id, is_enabled);

DROP TRIGGER IF EXISTS trg_set_org_cost_allocation_rule_centres ON public.cost_allocation_rule_centres;
CREATE TRIGGER trg_set_org_cost_allocation_rule_centres BEFORE INSERT ON public.cost_allocation_rule_centres
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

ALTER TABLE public.cost_allocation_rule_centres ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cost_allocation_rule_centres_tenant_all ON public.cost_allocation_rule_centres;
CREATE POLICY cost_allocation_rule_centres_tenant_all
  ON public.cost_allocation_rule_centres FOR ALL TO authenticated
  USING (public.is_platform_admin() OR (public.auth_staff_org_id() IS NOT NULL AND organization_id = public.auth_staff_org_id()))
  WITH CHECK (public.is_platform_admin() OR (public.auth_staff_org_id() IS NOT NULL AND organization_id = public.auth_staff_org_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cost_allocation_rule_centres TO authenticated;
