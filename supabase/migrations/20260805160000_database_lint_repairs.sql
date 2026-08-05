-- Repair legacy schema drift reported by `supabase db lint`.
-- This migration is idempotent and preserves existing data and function signatures.

ALTER TABLE public.organization_subscriptions
  ADD COLUMN IF NOT EXISTS notes text;

-- pgcrypto is installed in Supabase's extensions schema. Qualify its functions so
-- SECURITY DEFINER routines do not depend on a mutable search_path.
CREATE OR REPLACE FUNCTION public.create_financial_model_portal_link(
  p_model_id uuid,
  p_audience text,
  p_label text DEFAULT NULL,
  p_days integer DEFAULT 30
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_model public.financial_models; v_token text; v_link public.financial_model_portal_links;
BEGIN
 SELECT * INTO v_model FROM public.financial_models WHERE id=p_model_id;
 IF v_model.id IS NULL OR (NOT public.is_platform_admin() AND NOT public.user_is_member_of_org(v_model.organization_id)) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 IF v_model.status<>'approved' THEN RAISE EXCEPTION 'Only approved models can be shared externally'; END IF;
 IF p_audience NOT IN ('bank','investor') THEN RAISE EXCEPTION 'Invalid audience'; END IF;
 v_token:=encode(extensions.gen_random_bytes(24),'hex');
 INSERT INTO public.financial_model_portal_links(organization_id,model_id,audience,token_hash,label,snapshot,expires_at)
 VALUES(v_model.organization_id,v_model.id,p_audience,encode(extensions.digest(v_token,'sha256'),'hex'),nullif(trim(p_label),''),jsonb_build_object('name',v_model.name,'industry',v_model.industry,'currency',v_model.currency,'model_data',v_model.model_data),now()+make_interval(days=>greatest(1,least(p_days,365)))) RETURNING * INTO v_link;
 RETURN jsonb_build_object('id',v_link.id,'token',v_token,'audience',v_link.audience,'expires_at',v_link.expires_at);
END $$;

CREATE OR REPLACE FUNCTION public.get_financial_model_portal(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_link public.financial_model_portal_links; v_brand public.financial_model_branding;
BEGIN
 SELECT * INTO v_link FROM public.financial_model_portal_links WHERE token_hash=encode(extensions.digest(p_token,'sha256'),'hex') AND revoked_at IS NULL AND expires_at>now();
 IF v_link.id IS NULL THEN RETURN NULL; END IF;
 UPDATE public.financial_model_portal_links SET view_count=view_count+1,last_viewed_at=now() WHERE id=v_link.id;
 SELECT * INTO v_brand FROM public.financial_model_branding WHERE organization_id=v_link.organization_id;
 RETURN jsonb_build_object('audience',v_link.audience,'label',v_link.label,'expires_at',v_link.expires_at,'snapshot',v_link.snapshot,'branding',coalesce(to_jsonb(v_brand),'{}'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.create_financial_model_api_key(
  p_organization_id uuid,
  p_name text,
  p_scopes text[] DEFAULT ARRAY['models:read']
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_key text; v_row public.financial_model_api_clients;
BEGIN
 IF NOT public.is_platform_admin() AND NOT public.user_is_member_of_org(p_organization_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 v_key:='boat_fm_'||encode(extensions.gen_random_bytes(24),'hex');
 INSERT INTO public.financial_model_api_clients(organization_id,name,key_prefix,key_hash,scopes)
 VALUES(p_organization_id,trim(p_name),left(v_key,16),encode(extensions.digest(v_key,'sha256'),'hex'),p_scopes) RETURNING * INTO v_row;
 RETURN jsonb_build_object('id',v_row.id,'api_key',v_key,'prefix',v_row.key_prefix,'scopes',v_row.scopes);
END $$;

-- Repair live legacy function bodies while retaining their exact arguments,
-- return types, ownership, grants, and security attributes.
DO $$
DECLARE
  v_oid oid;
  v_definition text;
  v_code text;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='seed_microfinance_chart_of_accounts'
  ORDER BY p.oid LIMIT 1;

  IF v_oid IS NOT NULL THEN
    v_definition := pg_get_functiondef(v_oid);
    FOREACH v_code IN ARRAY ARRAY['1210','1220','4100','4110','4120','2120','4140','1110','1120','1130','1290','5200','5210','4160','1240'] LOOP
      v_definition := replace(
        v_definition,
        'max(id) filter(where account_code=''' || v_code || ''')',
        '(min(id::text) filter(where account_code=''' || v_code || '''))::uuid'
      );
    END LOOP;
    EXECUTE v_definition;
  END IF;

  FOR v_oid IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='checkin_guest'
  LOOP
    v_definition := pg_get_functiondef(v_oid);
    v_definition := regexp_replace(
      v_definition,
      E'(\\n\\s*)guest_id(\\s*,)',
      E'\\1property_customer_id\\2',
      'i'
    );
    EXECUTE v_definition;
  END LOOP;

  SELECT p.oid INTO v_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='wallet_post_transaction'
  ORDER BY p.oid LIMIT 1;

  IF v_oid IS NOT NULL THEN
    v_definition := pg_get_functiondef(v_oid);
    v_definition := regexp_replace(v_definition, E'\\s*v_cp_txn uuid;\\s*', E'\n', 'i');
    v_definition := regexp_replace(v_definition, E'\\)\\s+RETURNING id INTO v_cp_txn;', ');', 'i');
    EXECUTE v_definition;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.create_financial_model_portal_link(uuid,text,text,integer), public.create_financial_model_api_key(uuid,text,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_financial_model_portal_link(uuid,text,text,integer), public.create_financial_model_api_key(uuid,text,text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_financial_model_portal(text) TO anon, authenticated;
