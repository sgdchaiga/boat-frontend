-- Customer portal identities can point to existing BOAT users or externally provisioned auth users.
CREATE TABLE IF NOT EXISTS public.insurance_customer_portal_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.insurance_customers(id) ON DELETE CASCADE, auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_mode text NOT NULL CHECK(access_mode IN ('boat_user','external_portal')), active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id, auth_user_id), UNIQUE(customer_id, auth_user_id)
);
ALTER TABLE public.insurance_customer_portal_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY insurance_customer_portal_self ON public.insurance_customer_portal_access FOR SELECT TO authenticated USING (auth_user_id=auth.uid() OR public.insurance_org_access(organization_id));
CREATE POLICY insurance_customer_portal_agency ON public.insurance_customer_portal_access FOR ALL TO authenticated USING (public.insurance_org_access(organization_id)) WITH CHECK (public.insurance_org_access(organization_id));
CREATE OR REPLACE FUNCTION public.is_insurance_customer(p_customer_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM public.insurance_customer_portal_access a WHERE a.customer_id=p_customer_id AND a.auth_user_id=auth.uid() AND a.active) $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.insurance_customer_portal_access TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_insurance_customer(uuid) TO authenticated;
