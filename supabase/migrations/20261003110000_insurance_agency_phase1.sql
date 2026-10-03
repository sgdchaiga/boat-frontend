-- Phase 1: BOAT Insurance agency distribution workflow.
CREATE TABLE IF NOT EXISTS public.insurance_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.insurance_customers(id) ON DELETE SET NULL, customer_name text NOT NULL, product_category text NOT NULL,
  estimated_premium numeric(15,2), sum_insured numeric(15,2) NOT NULL DEFAULT 0, source text NOT NULL DEFAULT 'insurance_portal',
  stage text NOT NULL DEFAULT 'new_lead' CHECK (stage IN ('new_lead','quote_requested','quotes_received','customer_selected','kyc_pending','payment_pending','paid','policy_issued','active','renewal_due','renewal_quote','renewed')),
  assigned_officer_id uuid REFERENCES public.staff(id) ON DELETE SET NULL, expected_close_date date, notes text, last_activity_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.insurance_quotes ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES public.insurance_leads(id) ON DELETE SET NULL;
ALTER TABLE public.insurance_products ADD COLUMN IF NOT EXISTS description text, ADD COLUMN IF NOT EXISTS eligibility text, ADD COLUMN IF NOT EXISTS cover_details text, ADD COLUMN IF NOT EXISTS terms_reference text, ADD COLUMN IF NOT EXISTS pricing_method text NOT NULL DEFAULT 'manual', ADD COLUMN IF NOT EXISTS minimum_premium numeric(15,2), ADD COLUMN IF NOT EXISTS commission_rate_percent numeric(8,4), ADD COLUMN IF NOT EXISTS processing_method text NOT NULL DEFAULT 'manual' CHECK(processing_method IN ('manual','api'));
CREATE TABLE IF NOT EXISTS public.insurance_product_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, product_id uuid NOT NULL REFERENCES public.insurance_products(id) ON DELETE CASCADE,
  document_name text NOT NULL, required boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS public.insurance_kyc_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, quote_id uuid REFERENCES public.insurance_quotes(id) ON DELETE CASCADE,
  requirement_id uuid REFERENCES public.insurance_product_requirements(id) ON DELETE SET NULL, document_name text NOT NULL, storage_path text, status text NOT NULL DEFAULT 'required' CHECK(status IN ('required','submitted','verified','rejected','resubmit')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insurance_leads_org_stage ON public.insurance_leads(organization_id, stage, created_at DESC);
ALTER TABLE public.insurance_leads ENABLE ROW LEVEL SECURITY; ALTER TABLE public.insurance_product_requirements ENABLE ROW LEVEL SECURITY; ALTER TABLE public.insurance_kyc_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY insurance_org_insurance_leads ON public.insurance_leads FOR ALL TO authenticated USING (public.insurance_org_access(organization_id)) WITH CHECK (public.insurance_org_access(organization_id));
CREATE POLICY insurance_org_insurance_product_requirements ON public.insurance_product_requirements FOR ALL TO authenticated USING (public.insurance_org_access(organization_id)) WITH CHECK (public.insurance_org_access(organization_id));
CREATE POLICY insurance_org_insurance_kyc_documents ON public.insurance_kyc_documents FOR ALL TO authenticated USING (public.insurance_org_access(organization_id)) WITH CHECK (public.insurance_org_access(organization_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.insurance_leads, public.insurance_product_requirements, public.insurance_kyc_documents TO authenticated;
