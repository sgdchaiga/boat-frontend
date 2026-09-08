CREATE TABLE IF NOT EXISTS public.organization_mobile_lite_policies (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role text NOT NULL,
  shortcuts jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (organization_id, role),
  CONSTRAINT mobile_lite_shortcuts_array CHECK (jsonb_typeof(shortcuts) = 'array')
);

ALTER TABLE public.organization_mobile_lite_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mobile_lite_policy_read ON public.organization_mobile_lite_policies;
CREATE POLICY mobile_lite_policy_read ON public.organization_mobile_lite_policies
  FOR SELECT USING (
    public.is_platform_admin() OR public.user_is_member_of_org(organization_id)
  );

DROP POLICY IF EXISTS mobile_lite_policy_admin_write ON public.organization_mobile_lite_policies;
CREATE POLICY mobile_lite_policy_admin_write ON public.organization_mobile_lite_policies
  FOR ALL USING (
    public.is_platform_admin() OR EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = auth.uid() AND s.organization_id = organization_mobile_lite_policies.organization_id
        AND lower(coalesce(s.role::text, '')) IN ('admin', 'manager', 'super_admin')
    )
  ) WITH CHECK (
    public.is_platform_admin() OR EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = auth.uid() AND s.organization_id = organization_mobile_lite_policies.organization_id
        AND lower(coalesce(s.role::text, '')) IN ('admin', 'manager', 'super_admin')
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_mobile_lite_policies TO authenticated;
