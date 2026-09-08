CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.financial_model_collaborators (
  model_id uuid NOT NULL REFERENCES public.financial_models(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','editor','reviewer','viewer')),
  created_by uuid NOT NULL DEFAULT auth.uid(), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(model_id,user_id)
);

CREATE TABLE IF NOT EXISTS public.financial_model_branding (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT 'BOAT Financial Modelling Studio', logo_url text NULL,
  primary_color text NOT NULL DEFAULT '#047857', accent_color text NOT NULL DEFAULT '#6ee7b7',
  report_footer text NULL, updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.financial_model_portal_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES public.financial_models(id) ON DELETE CASCADE,
  audience text NOT NULL CHECK (audience IN ('bank','investor')), token_hash text NOT NULL UNIQUE,
  label text NULL, snapshot jsonb NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz NULL,
  created_by uuid NOT NULL DEFAULT auth.uid(), created_at timestamptz NOT NULL DEFAULT now(), last_viewed_at timestamptz NULL, view_count integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.financial_model_api_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL, key_prefix text NOT NULL, key_hash text NOT NULL UNIQUE, scopes text[] NOT NULL DEFAULT ARRAY['models:read'],
  active boolean NOT NULL DEFAULT true, created_by uuid NOT NULL DEFAULT auth.uid(), created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz NULL
);

CREATE TABLE IF NOT EXISTS public.financial_model_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL, endpoint_url text NOT NULL CHECK (endpoint_url ~ '^https://'), events text[] NOT NULL DEFAULT ARRAY['model.approved'],
  active boolean NOT NULL DEFAULT true, created_by uuid NOT NULL DEFAULT auth.uid(), created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.financial_model_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_model_branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_model_portal_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_model_api_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_model_webhooks ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_manage_financial_model(p_model_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.is_platform_admin() OR EXISTS (
    SELECT 1 FROM public.financial_models fm
    WHERE fm.id=p_model_id AND (fm.created_by=auth.uid() OR EXISTS (
      SELECT 1 FROM public.financial_model_collaborators c WHERE c.model_id=fm.id AND c.user_id=auth.uid() AND c.role='owner'
    ))
  );
$$;

CREATE POLICY financial_model_collaborators_read ON public.financial_model_collaborators FOR SELECT USING (public.is_platform_admin() OR public.user_is_member_of_org(organization_id));
CREATE POLICY financial_model_collaborators_manage ON public.financial_model_collaborators FOR ALL USING (public.can_manage_financial_model(model_id)) WITH CHECK (public.can_manage_financial_model(model_id));
CREATE POLICY financial_model_branding_org ON public.financial_model_branding FOR ALL USING (public.is_platform_admin() OR public.user_is_member_of_org(organization_id)) WITH CHECK (public.is_platform_admin() OR public.user_is_member_of_org(organization_id));
CREATE POLICY financial_model_portal_links_org ON public.financial_model_portal_links FOR ALL USING (public.is_platform_admin() OR public.user_is_member_of_org(organization_id)) WITH CHECK (public.is_platform_admin() OR public.user_is_member_of_org(organization_id));
CREATE POLICY financial_model_api_clients_org ON public.financial_model_api_clients FOR ALL USING (public.is_platform_admin() OR public.user_is_member_of_org(organization_id)) WITH CHECK (public.is_platform_admin() OR public.user_is_member_of_org(organization_id));
CREATE POLICY financial_model_webhooks_org ON public.financial_model_webhooks FOR ALL USING (public.is_platform_admin() OR public.user_is_member_of_org(organization_id)) WITH CHECK (public.is_platform_admin() OR public.user_is_member_of_org(organization_id));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.financial_model_collaborators,public.financial_model_branding,public.financial_model_portal_links,public.financial_model_api_clients,public.financial_model_webhooks TO authenticated;

DROP POLICY IF EXISTS financial_models_org_access ON public.financial_models;
CREATE POLICY financial_models_insert ON public.financial_models FOR INSERT WITH CHECK (public.is_platform_admin() OR public.user_is_member_of_org(organization_id));
CREATE POLICY financial_models_read ON public.financial_models FOR SELECT USING (public.is_platform_admin() OR (public.user_is_member_of_org(organization_id) AND (created_by=auth.uid() OR EXISTS (SELECT 1 FROM public.financial_model_collaborators c WHERE c.model_id=id AND c.user_id=auth.uid()))));
CREATE POLICY financial_models_update ON public.financial_models FOR UPDATE USING (public.is_platform_admin() OR created_by=auth.uid() OR EXISTS (SELECT 1 FROM public.financial_model_collaborators c WHERE c.model_id=id AND c.user_id=auth.uid() AND c.role IN ('owner','editor'))) WITH CHECK (public.is_platform_admin() OR created_by=auth.uid() OR EXISTS (SELECT 1 FROM public.financial_model_collaborators c WHERE c.model_id=id AND c.user_id=auth.uid() AND c.role IN ('owner','editor')));
CREATE POLICY financial_models_delete ON public.financial_models FOR DELETE USING (public.is_platform_admin() OR created_by=auth.uid() OR EXISTS (SELECT 1 FROM public.financial_model_collaborators c WHERE c.model_id=id AND c.user_id=auth.uid() AND c.role='owner'));

CREATE OR REPLACE FUNCTION public.create_financial_model_portal_link(p_model_id uuid,p_audience text,p_label text DEFAULT NULL,p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_model public.financial_models; v_token text; v_link public.financial_model_portal_links;
BEGIN
 SELECT * INTO v_model FROM public.financial_models WHERE id=p_model_id;
 IF v_model.id IS NULL OR (NOT public.is_platform_admin() AND NOT public.user_is_member_of_org(v_model.organization_id)) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 IF v_model.status<>'approved' THEN RAISE EXCEPTION 'Only approved models can be shared externally'; END IF;
 IF p_audience NOT IN ('bank','investor') THEN RAISE EXCEPTION 'Invalid audience'; END IF;
 v_token:=encode(gen_random_bytes(24),'hex');
 INSERT INTO public.financial_model_portal_links(organization_id,model_id,audience,token_hash,label,snapshot,expires_at)
 VALUES(v_model.organization_id,v_model.id,p_audience,encode(digest(v_token,'sha256'),'hex'),nullif(trim(p_label),''),jsonb_build_object('name',v_model.name,'industry',v_model.industry,'currency',v_model.currency,'model_data',v_model.model_data),now()+make_interval(days=>greatest(1,least(p_days,365)))) RETURNING * INTO v_link;
 RETURN jsonb_build_object('id',v_link.id,'token',v_token,'audience',v_link.audience,'expires_at',v_link.expires_at);
END $$;

CREATE OR REPLACE FUNCTION public.get_financial_model_portal(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_link public.financial_model_portal_links; v_brand public.financial_model_branding;
BEGIN
 SELECT * INTO v_link FROM public.financial_model_portal_links WHERE token_hash=encode(digest(p_token,'sha256'),'hex') AND revoked_at IS NULL AND expires_at>now();
 IF v_link.id IS NULL THEN RETURN NULL; END IF;
 UPDATE public.financial_model_portal_links SET view_count=view_count+1,last_viewed_at=now() WHERE id=v_link.id;
 SELECT * INTO v_brand FROM public.financial_model_branding WHERE organization_id=v_link.organization_id;
 RETURN jsonb_build_object('audience',v_link.audience,'label',v_link.label,'expires_at',v_link.expires_at,'snapshot',v_link.snapshot,'branding',coalesce(to_jsonb(v_brand),'{}'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.create_financial_model_api_key(p_organization_id uuid,p_name text,p_scopes text[] DEFAULT ARRAY['models:read'])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_key text; v_row public.financial_model_api_clients;
BEGIN
 IF NOT public.is_platform_admin() AND NOT public.user_is_member_of_org(p_organization_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 v_key:='boat_fm_'||encode(gen_random_bytes(24),'hex');
 INSERT INTO public.financial_model_api_clients(organization_id,name,key_prefix,key_hash,scopes)
 VALUES(p_organization_id,trim(p_name),left(v_key,16),encode(digest(v_key,'sha256'),'hex'),p_scopes) RETURNING * INTO v_row;
 RETURN jsonb_build_object('id',v_row.id,'api_key',v_key,'prefix',v_row.key_prefix,'scopes',v_row.scopes);
END $$;

REVOKE ALL ON FUNCTION public.create_financial_model_portal_link(uuid,text,text,integer),public.create_financial_model_api_key(uuid,text,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_financial_model_portal_link(uuid,text,text,integer),public.create_financial_model_api_key(uuid,text,text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_financial_model_portal(text) TO anon,authenticated;
