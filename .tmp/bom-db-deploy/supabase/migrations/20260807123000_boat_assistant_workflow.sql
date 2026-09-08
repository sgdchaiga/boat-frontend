-- Durable, organization-scoped BOAT Assistant suggestions, approvals and audit history.
CREATE TABLE IF NOT EXISTS public.boat_assistant_policies (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  high_value_threshold numeric(18,2) NOT NULL DEFAULT 1000000 CHECK (high_value_threshold >= 0),
  default_mode text NOT NULL DEFAULT 'guided' CHECK (default_mode IN ('manual','guided','assisted','automatic','accountant_supervised')),
  automatic_enabled boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.boat_assistant_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
  original_instruction text NOT NULL,
  understood text NOT NULL,
  recommended_treatment text NOT NULL,
  draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  target_page text,
  amount numeric(18,2),
  currency text,
  confidence text NOT NULL CHECK (confidence IN ('high','medium','low')),
  risk text NOT NULL CHECK (risk IN ('high','medium','low')),
  status text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','confirmed','approval_required','approved','rejected','deferred','cancelled')),
  approval_required boolean NOT NULL DEFAULT false,
  assigned_role text CHECK (assigned_role IS NULL OR assigned_role IN ('admin','manager','accountant')),
  reviewed_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.boat_assistant_activity (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  suggestion_id uuid REFERENCES public.boat_assistant_suggestions(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
  action text NOT NULL,
  original_values jsonb,
  final_values jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_boat_assistant_suggestions_attention ON public.boat_assistant_suggestions(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_boat_assistant_activity_org ON public.boat_assistant_activity(organization_id, created_at DESC);

ALTER TABLE public.boat_assistant_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boat_assistant_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boat_assistant_activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "boat_assistant_policies_read" ON public.boat_assistant_policies;
CREATE POLICY "boat_assistant_policies_read" ON public.boat_assistant_policies FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.staff s WHERE s.id = (SELECT auth.uid()) AND s.organization_id = boat_assistant_policies.organization_id) OR public.is_platform_admin());

DROP POLICY IF EXISTS "boat_assistant_policies_manage" ON public.boat_assistant_policies;
CREATE POLICY "boat_assistant_policies_manage" ON public.boat_assistant_policies FOR ALL TO authenticated
USING (public.is_platform_admin() OR EXISTS (SELECT 1 FROM public.staff s WHERE s.id = (SELECT auth.uid()) AND s.organization_id = boat_assistant_policies.organization_id AND s.role IN ('admin','manager')))
WITH CHECK (public.is_platform_admin() OR EXISTS (SELECT 1 FROM public.staff s WHERE s.id = (SELECT auth.uid()) AND s.organization_id = boat_assistant_policies.organization_id AND s.role IN ('admin','manager')));

DROP POLICY IF EXISTS "boat_assistant_suggestions_org_read" ON public.boat_assistant_suggestions;
CREATE POLICY "boat_assistant_suggestions_org_read" ON public.boat_assistant_suggestions FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.staff s WHERE s.id = (SELECT auth.uid()) AND s.organization_id = boat_assistant_suggestions.organization_id) OR public.is_platform_admin());

DROP POLICY IF EXISTS "boat_assistant_suggestions_create" ON public.boat_assistant_suggestions;
CREATE POLICY "boat_assistant_suggestions_create" ON public.boat_assistant_suggestions FOR INSERT TO authenticated
WITH CHECK (created_by = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.staff s JOIN public.organizations o ON o.id = s.organization_id WHERE s.id = (SELECT auth.uid()) AND s.organization_id = boat_assistant_suggestions.organization_id AND o.enable_assistant = true));

DROP POLICY IF EXISTS "boat_assistant_suggestions_update" ON public.boat_assistant_suggestions;
CREATE POLICY "boat_assistant_suggestions_update" ON public.boat_assistant_suggestions FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.staff s WHERE s.id = (SELECT auth.uid()) AND s.organization_id = boat_assistant_suggestions.organization_id AND (s.id = boat_assistant_suggestions.created_by OR s.role IN ('admin','manager','accountant'))))
WITH CHECK (EXISTS (SELECT 1 FROM public.staff s WHERE s.id = (SELECT auth.uid()) AND s.organization_id = boat_assistant_suggestions.organization_id AND (s.id = boat_assistant_suggestions.created_by OR s.role IN ('admin','manager','accountant'))));

DROP POLICY IF EXISTS "boat_assistant_activity_read" ON public.boat_assistant_activity;
CREATE POLICY "boat_assistant_activity_read" ON public.boat_assistant_activity FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.staff s WHERE s.id = (SELECT auth.uid()) AND s.organization_id = boat_assistant_activity.organization_id) OR public.is_platform_admin());

DROP POLICY IF EXISTS "boat_assistant_activity_append" ON public.boat_assistant_activity;
CREATE POLICY "boat_assistant_activity_append" ON public.boat_assistant_activity FOR INSERT TO authenticated
WITH CHECK (actor_id = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.staff s WHERE s.id = (SELECT auth.uid()) AND s.organization_id = boat_assistant_activity.organization_id));

GRANT SELECT, INSERT, UPDATE ON public.boat_assistant_suggestions TO authenticated;
GRANT SELECT, INSERT ON public.boat_assistant_activity TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.boat_assistant_policies TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.boat_assistant_activity_id_seq TO authenticated;
