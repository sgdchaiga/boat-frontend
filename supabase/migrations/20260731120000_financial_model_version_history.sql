CREATE TABLE IF NOT EXISTS public.financial_model_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES public.financial_models(id) ON DELETE CASCADE,
  version_no integer NOT NULL CHECK (version_no > 0),
  model_status text NOT NULL,
  change_summary text NOT NULL DEFAULT 'Model saved',
  model_snapshot jsonb NOT NULL,
  created_by uuid NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (model_id, version_no)
);

CREATE INDEX IF NOT EXISTS financial_model_versions_model_idx
  ON public.financial_model_versions(model_id, version_no DESC);

ALTER TABLE public.financial_model_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS financial_model_versions_org_read ON public.financial_model_versions;
CREATE POLICY financial_model_versions_org_read ON public.financial_model_versions FOR SELECT
  USING (public.is_platform_admin() OR public.user_is_member_of_org(organization_id));
GRANT SELECT ON public.financial_model_versions TO authenticated;

CREATE OR REPLACE FUNCTION public.create_financial_model_version(p_model_id uuid, p_change_summary text DEFAULT NULL)
RETURNS public.financial_model_versions
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_model public.financial_models; v_version public.financial_model_versions; v_next integer;
BEGIN
  SELECT * INTO v_model FROM public.financial_models WHERE id=p_model_id FOR UPDATE;
  IF v_model.id IS NULL THEN RAISE EXCEPTION 'Financial model not found'; END IF;
  IF NOT public.is_platform_admin() AND NOT public.user_is_member_of_org(v_model.organization_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT COALESCE(MAX(version_no),0)+1 INTO v_next FROM public.financial_model_versions WHERE model_id=p_model_id;
  INSERT INTO public.financial_model_versions(organization_id,model_id,version_no,model_status,change_summary,model_snapshot)
  VALUES(v_model.organization_id,v_model.id,v_next,v_model.status,COALESCE(NULLIF(trim(p_change_summary),''),'Model saved'),v_model.model_data)
  RETURNING * INTO v_version;
  RETURN v_version;
END $$;

REVOKE ALL ON FUNCTION public.create_financial_model_version(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_financial_model_version(uuid,text) TO authenticated;

COMMENT ON TABLE public.financial_model_versions IS 'Immutable financial-model snapshots created on explicit saves for audit and review traceability.';
