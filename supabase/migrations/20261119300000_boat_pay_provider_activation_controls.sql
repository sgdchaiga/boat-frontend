-- Phase 4: provider secrets remain in Edge Function environment variables.
-- A platform administrator may enable the prebuilt adapter only after its
-- regulated-provider agreement and webhook secret have been configured.
CREATE TABLE IF NOT EXISTS public.boat_pay_provider_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code text NOT NULL UNIQUE CHECK (provider_code IN ('flutterwave')),
  enabled boolean NOT NULL DEFAULT false,
  module_codes text[] NOT NULL DEFAULT ARRAY['vsla']::text[] CHECK (module_codes <@ ARRAY['vsla']::text[]),
  webhook_secret_env text NOT NULL DEFAULT 'FLW_WEBHOOK_HASH' CHECK (webhook_secret_env='FLW_WEBHOOK_HASH'),
  enabled_at timestamptz,
  enabled_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.boat_pay_provider_connections ENABLE ROW LEVEL SECURITY;
-- This contains no credentials, only provider availability. All signed secrets
-- remain in Edge Function environment variables, so VSLA operators may see
-- whether a provider is available without gaining access to configuration data.
CREATE POLICY boat_pay_provider_connections_read ON public.boat_pay_provider_connections FOR SELECT TO authenticated USING(true);
REVOKE ALL ON public.boat_pay_provider_connections FROM authenticated;
GRANT SELECT ON public.boat_pay_provider_connections TO authenticated;

CREATE OR REPLACE FUNCTION public.set_boat_pay_provider_connection(
  p_provider_code text,
  p_enabled boolean,
  p_module_codes text[] DEFAULT ARRAY['vsla']::text[]
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Platform administrator access is required'; END IF;
  IF lower(trim(coalesce(p_provider_code,'')))<>'flutterwave' OR p_module_codes IS NULL OR NOT (p_module_codes <@ ARRAY['vsla']::text[]) THEN RAISE EXCEPTION 'Unsupported BOAT Pay provider configuration'; END IF;
  INSERT INTO public.boat_pay_provider_connections(provider_code,enabled,module_codes,enabled_at,enabled_by,updated_at)
  VALUES('flutterwave',p_enabled,p_module_codes,CASE WHEN p_enabled THEN now() ELSE NULL END,CASE WHEN p_enabled THEN auth.uid() ELSE NULL END,now())
  ON CONFLICT(provider_code) DO UPDATE SET enabled=EXCLUDED.enabled,module_codes=EXCLUDED.module_codes,enabled_at=EXCLUDED.enabled_at,enabled_by=EXCLUDED.enabled_by,updated_at=EXCLUDED.updated_at;
END $$;
REVOKE ALL ON FUNCTION public.set_boat_pay_provider_connection(text,boolean,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_boat_pay_provider_connection(text,boolean,text[]) TO authenticated;
