CREATE TABLE IF NOT EXISTS public.organization_industry_intelligence_state (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  completed_recommendations text[] NOT NULL DEFAULT '{}',
  dismissed_recommendations text[] NOT NULL DEFAULT '{}',
  last_reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.organization_industry_intelligence_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_industry_intelligence_state_org_access
  ON public.organization_industry_intelligence_state;
CREATE POLICY organization_industry_intelligence_state_org_access
  ON public.organization_industry_intelligence_state
  FOR ALL
  USING (public.is_platform_admin() OR public.user_is_member_of_org(organization_id))
  WITH CHECK (public.is_platform_admin() OR public.user_is_member_of_org(organization_id));

CREATE OR REPLACE FUNCTION public.update_organization_industry_intelligence_state(
  p_organization_id uuid,
  p_completed_recommendations text[] DEFAULT NULL,
  p_dismissed_recommendations text[] DEFAULT NULL,
  p_mark_reviewed boolean DEFAULT false
)
RETURNS public.organization_industry_intelligence_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.organization_industry_intelligence_state;
BEGIN
  IF NOT public.is_platform_admin() AND NOT public.user_is_member_of_org(p_organization_id) THEN
    RAISE EXCEPTION 'Not allowed to update industry intelligence state for this organization';
  END IF;

  INSERT INTO public.organization_industry_intelligence_state (organization_id)
  VALUES (p_organization_id)
  ON CONFLICT (organization_id) DO NOTHING;

  UPDATE public.organization_industry_intelligence_state
  SET
    completed_recommendations = CASE
      WHEN p_completed_recommendations IS NULL THEN completed_recommendations
      ELSE ARRAY(
        SELECT DISTINCT value
        FROM unnest(completed_recommendations || p_completed_recommendations) AS value
        WHERE value IS NOT NULL AND btrim(value) <> ''
        ORDER BY value
      )
    END,
    dismissed_recommendations = CASE
      WHEN p_dismissed_recommendations IS NULL THEN dismissed_recommendations
      ELSE ARRAY(
        SELECT DISTINCT value
        FROM unnest(dismissed_recommendations || p_dismissed_recommendations) AS value
        WHERE value IS NOT NULL AND btrim(value) <> ''
        ORDER BY value
      )
    END,
    last_reviewed_at = CASE WHEN p_mark_reviewed THEN now() ELSE last_reviewed_at END,
    updated_at = now()
  WHERE organization_id = p_organization_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.update_organization_industry_intelligence_state(uuid, text[], text[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_organization_industry_intelligence_state(uuid, text[], text[], boolean) TO authenticated;
