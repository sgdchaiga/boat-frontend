CREATE TABLE IF NOT EXISTS public.financial_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  industry text NOT NULL,
  currency text NOT NULL DEFAULT 'UGX',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'archived')),
  model_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS financial_models_org_updated_idx
  ON public.financial_models (organization_id, updated_at DESC);

ALTER TABLE public.financial_models ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS financial_models_org_access ON public.financial_models;
CREATE POLICY financial_models_org_access ON public.financial_models
  FOR ALL
  USING (public.is_platform_admin() OR public.user_is_member_of_org(organization_id))
  WITH CHECK (public.is_platform_admin() OR public.user_is_member_of_org(organization_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_models TO authenticated;

