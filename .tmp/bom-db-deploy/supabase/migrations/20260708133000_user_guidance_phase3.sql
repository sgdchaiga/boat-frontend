CREATE TABLE IF NOT EXISTS public.organization_guidance_state (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  active_tour text,
  completed_tours text[] NOT NULL DEFAULT '{}',
  dismissed_topics text[] NOT NULL DEFAULT '{}',
  assistant_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.organization_guidance_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_guidance_state_org_access ON public.organization_guidance_state;
CREATE POLICY organization_guidance_state_org_access
  ON public.organization_guidance_state
  FOR ALL
  USING (public.is_platform_admin() OR public.user_is_member_of_org(organization_id))
  WITH CHECK (public.is_platform_admin() OR public.user_is_member_of_org(organization_id));

CREATE OR REPLACE FUNCTION public.update_organization_guidance_state(
  p_organization_id uuid,
  p_active_tour text DEFAULT NULL,
  p_completed_tours text[] DEFAULT NULL,
  p_dismissed_topics text[] DEFAULT NULL,
  p_assistant_history jsonb DEFAULT NULL
)
RETURNS public.organization_guidance_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.organization_guidance_state;
BEGIN
  IF NOT public.is_platform_admin() AND NOT public.user_is_member_of_org(p_organization_id) THEN
    RAISE EXCEPTION 'Not allowed to update guidance state for this organization';
  END IF;

  INSERT INTO public.organization_guidance_state (organization_id)
  VALUES (p_organization_id)
  ON CONFLICT (organization_id) DO NOTHING;

  UPDATE public.organization_guidance_state
  SET
    active_tour = COALESCE(p_active_tour, active_tour),
    completed_tours = CASE
      WHEN p_completed_tours IS NULL THEN completed_tours
      ELSE ARRAY(
        SELECT DISTINCT value
        FROM unnest(completed_tours || p_completed_tours) AS value
        WHERE value IS NOT NULL AND btrim(value) <> ''
        ORDER BY value
      )
    END,
    dismissed_topics = CASE
      WHEN p_dismissed_topics IS NULL THEN dismissed_topics
      ELSE ARRAY(
        SELECT DISTINCT value
        FROM unnest(dismissed_topics || p_dismissed_topics) AS value
        WHERE value IS NOT NULL AND btrim(value) <> ''
        ORDER BY value
      )
    END,
    assistant_history = CASE
      WHEN p_assistant_history IS NULL THEN assistant_history
      WHEN jsonb_typeof(p_assistant_history) = 'array' THEN assistant_history || p_assistant_history
      ELSE assistant_history || jsonb_build_array(p_assistant_history)
    END,
    updated_at = now()
  WHERE organization_id = p_organization_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.update_organization_guidance_state(uuid, text, text[], text[], jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_organization_guidance_state(uuid, text, text[], text[], jsonb) TO authenticated;
