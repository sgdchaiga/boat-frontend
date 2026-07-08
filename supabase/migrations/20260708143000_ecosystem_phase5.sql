CREATE TABLE IF NOT EXISTS public.organization_ecosystem_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  installed_modules text[] NOT NULL DEFAULT '{}',
  enabled_connectors text[] NOT NULL DEFAULT '{}',
  api_clients jsonb NOT NULL DEFAULT '[]'::jsonb,
  webhooks jsonb NOT NULL DEFAULT '[]'::jsonb,
  mobile_channels jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.organization_ecosystem_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_ecosystem_settings_org_access
  ON public.organization_ecosystem_settings;
CREATE POLICY organization_ecosystem_settings_org_access
  ON public.organization_ecosystem_settings
  FOR ALL
  USING (public.is_platform_admin() OR public.user_is_member_of_org(organization_id))
  WITH CHECK (public.is_platform_admin() OR public.user_is_member_of_org(organization_id));

CREATE OR REPLACE FUNCTION public.update_organization_ecosystem_settings(
  p_organization_id uuid,
  p_installed_modules text[] DEFAULT NULL,
  p_enabled_connectors text[] DEFAULT NULL,
  p_api_clients jsonb DEFAULT NULL,
  p_webhooks jsonb DEFAULT NULL,
  p_mobile_channels jsonb DEFAULT NULL
)
RETURNS public.organization_ecosystem_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.organization_ecosystem_settings;
BEGIN
  IF NOT public.is_platform_admin() AND NOT public.user_is_member_of_org(p_organization_id) THEN
    RAISE EXCEPTION 'Not allowed to update ecosystem settings for this organization';
  END IF;

  INSERT INTO public.organization_ecosystem_settings (organization_id)
  VALUES (p_organization_id)
  ON CONFLICT (organization_id) DO NOTHING;

  UPDATE public.organization_ecosystem_settings
  SET
    installed_modules = COALESCE(p_installed_modules, installed_modules),
    enabled_connectors = COALESCE(p_enabled_connectors, enabled_connectors),
    api_clients = COALESCE(p_api_clients, api_clients),
    webhooks = COALESCE(p_webhooks, webhooks),
    mobile_channels = COALESCE(p_mobile_channels, mobile_channels),
    updated_at = now()
  WHERE organization_id = p_organization_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.update_organization_ecosystem_settings(uuid, text[], text[], jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_organization_ecosystem_settings(uuid, text[], text[], jsonb, jsonb, jsonb) TO authenticated;

