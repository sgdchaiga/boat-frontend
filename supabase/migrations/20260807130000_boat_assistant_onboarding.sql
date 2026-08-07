CREATE TABLE IF NOT EXISTS public.boat_assistant_onboarding (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  proposed_configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','proposed','active')),
  proposed_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  activated_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  proposed_at timestamptz,
  activated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.boat_assistant_onboarding ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "boat_assistant_onboarding_read" ON public.boat_assistant_onboarding;
CREATE POLICY "boat_assistant_onboarding_read" ON public.boat_assistant_onboarding FOR SELECT TO authenticated
USING (public.is_platform_admin() OR EXISTS (SELECT 1 FROM public.staff s WHERE s.id = (SELECT auth.uid()) AND s.organization_id = boat_assistant_onboarding.organization_id));
DROP POLICY IF EXISTS "boat_assistant_onboarding_manage" ON public.boat_assistant_onboarding;
CREATE POLICY "boat_assistant_onboarding_manage" ON public.boat_assistant_onboarding FOR ALL TO authenticated
USING (public.is_platform_admin() OR EXISTS (SELECT 1 FROM public.staff s WHERE s.id = (SELECT auth.uid()) AND s.organization_id = boat_assistant_onboarding.organization_id AND s.role IN ('admin','manager')))
WITH CHECK (public.is_platform_admin() OR EXISTS (SELECT 1 FROM public.staff s WHERE s.id = (SELECT auth.uid()) AND s.organization_id = boat_assistant_onboarding.organization_id AND s.role IN ('admin','manager')));
GRANT SELECT, INSERT, UPDATE ON public.boat_assistant_onboarding TO authenticated;
