-- BOAT Insurance is a platform-level service: every record is scoped to an organization
-- and policy items can refer to assets, vehicles, employees, students, loans or stock.
CREATE TABLE IF NOT EXISTS public.insurance_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL, contact_name text, phone text, email text, settlement_terms text, api_config jsonb NOT NULL DEFAULT '{}'::jsonb, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id, name)
);
CREATE TABLE IF NOT EXISTS public.insurance_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider_id uuid REFERENCES public.insurance_providers(id) ON DELETE SET NULL, name text NOT NULL, category text NOT NULL, required_documents jsonb NOT NULL DEFAULT '[]'::jsonb, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.insurance_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  boat_record_type text, boat_record_id uuid, display_name text NOT NULL, phone text, email text, kyc jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.insurance_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  quote_number text, customer_id uuid REFERENCES public.insurance_customers(id) ON DELETE SET NULL, customer_name text NOT NULL, product_category text NOT NULL, sum_insured numeric(15,2) NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','requested','options_received','accepted','declined','expired')), requested_at timestamptz NOT NULL DEFAULT now(), expires_at date, notes text
);
CREATE TABLE IF NOT EXISTS public.insurance_quote_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quote_id uuid NOT NULL REFERENCES public.insurance_quotes(id) ON DELETE CASCADE, provider_id uuid REFERENCES public.insurance_providers(id) ON DELETE SET NULL,
  provider_name text NOT NULL, cover_name text NOT NULL, premium_amount numeric(15,2) NOT NULL DEFAULT 0, excess_amount numeric(15,2), benefits text, selected boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.insurance_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  quote_id uuid REFERENCES public.insurance_quotes(id) ON DELETE SET NULL, customer_id uuid REFERENCES public.insurance_customers(id) ON DELETE SET NULL,
  policy_number text NOT NULL, customer_name text NOT NULL, product_name text NOT NULL, insurer_name text NOT NULL, sum_insured numeric(15,2) NOT NULL DEFAULT 0, premium_amount numeric(15,2) NOT NULL DEFAULT 0,
  start_date date, expiry_date date, status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','expired','cancelled')), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id, policy_number)
);
CREATE TABLE IF NOT EXISTS public.insurance_policy_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), policy_id uuid NOT NULL REFERENCES public.insurance_policies(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, item_type text NOT NULL, item_id uuid, description text NOT NULL, sum_insured numeric(15,2) NOT NULL DEFAULT 0, metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS public.insurance_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, policy_id uuid NOT NULL REFERENCES public.insurance_policies(id) ON DELETE CASCADE,
  amount numeric(15,2) NOT NULL CHECK(amount >= 0), paid_at date NOT NULL DEFAULT current_date, payment_method text, reference text, status text NOT NULL DEFAULT 'received' CHECK(status IN ('pending','received','reversed')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.insurance_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, policy_id uuid REFERENCES public.insurance_policies(id) ON DELETE SET NULL,
  rate_percent numeric(8,4) NOT NULL DEFAULT 0, expected_amount numeric(15,2) NOT NULL DEFAULT 0, received_amount numeric(15,2) NOT NULL DEFAULT 0, received_at date, status text NOT NULL DEFAULT 'expected' CHECK(status IN ('expected','partial','received','written_off')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.insurance_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, policy_id uuid NOT NULL REFERENCES public.insurance_policies(id) ON DELETE CASCADE,
  claim_number text, incident_date date, amount_claimed numeric(15,2) NOT NULL DEFAULT 0, amount_approved numeric(15,2), amount_settled numeric(15,2), settlement_date date,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','under_review','additional_information','approved','rejected','settled','closed')), incident_details text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.insurance_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, policy_id uuid REFERENCES public.insurance_policies(id) ON DELETE CASCADE,
  claim_id uuid REFERENCES public.insurance_claims(id) ON DELETE CASCADE, document_type text NOT NULL, storage_path text NOT NULL, file_name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insurance_policies_org_expiry ON public.insurance_policies(organization_id, expiry_date);
CREATE INDEX IF NOT EXISTS idx_insurance_quotes_org_status ON public.insurance_quotes(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_insurance_claims_org_status ON public.insurance_claims(organization_id, status);

ALTER TABLE public.insurance_providers ENABLE ROW LEVEL SECURITY; ALTER TABLE public.insurance_products ENABLE ROW LEVEL SECURITY; ALTER TABLE public.insurance_customers ENABLE ROW LEVEL SECURITY; ALTER TABLE public.insurance_quotes ENABLE ROW LEVEL SECURITY; ALTER TABLE public.insurance_quote_options ENABLE ROW LEVEL SECURITY; ALTER TABLE public.insurance_policies ENABLE ROW LEVEL SECURITY; ALTER TABLE public.insurance_policy_items ENABLE ROW LEVEL SECURITY; ALTER TABLE public.insurance_payments ENABLE ROW LEVEL SECURITY; ALTER TABLE public.insurance_commissions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.insurance_claims ENABLE ROW LEVEL SECURITY; ALTER TABLE public.insurance_documents ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.insurance_org_access(target_org uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT public.is_platform_admin() OR EXISTS (SELECT 1 FROM public.staff s WHERE s.id = auth.uid() AND s.organization_id = target_org) $$;
REVOKE ALL ON FUNCTION public.insurance_org_access(uuid) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.insurance_org_access(uuid) TO authenticated;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['insurance_providers','insurance_products','insurance_customers','insurance_quotes','insurance_policies','insurance_policy_items','insurance_payments','insurance_commissions','insurance_claims','insurance_documents'] LOOP EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.insurance_org_access(organization_id)) WITH CHECK (public.insurance_org_access(organization_id))', 'insurance_org_' || t, t); END LOOP; END $$;
CREATE POLICY insurance_org_insurance_quote_options ON public.insurance_quote_options FOR ALL TO authenticated USING (EXISTS(SELECT 1 FROM public.insurance_quotes q WHERE q.id=quote_id AND public.insurance_org_access(q.organization_id))) WITH CHECK (EXISTS(SELECT 1 FROM public.insurance_quotes q WHERE q.id=quote_id AND public.insurance_org_access(q.organization_id)));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.insurance_providers, public.insurance_products, public.insurance_customers, public.insurance_quotes, public.insurance_quote_options, public.insurance_policies, public.insurance_policy_items, public.insurance_payments, public.insurance_commissions, public.insurance_claims, public.insurance_documents TO authenticated;
