CREATE TABLE IF NOT EXISTS public.insurance_renewals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, policy_id uuid NOT NULL REFERENCES public.insurance_policies(id) ON DELETE CASCADE,
  expiry_date date NOT NULL, stage text NOT NULL DEFAULT 'renewal_due' CHECK(stage IN ('renewal_due','renewal_quote','accepted','paid','renewed','lost')), reminder_bucket text NOT NULL DEFAULT '31_60', quote_id uuid REFERENCES public.insurance_quotes(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(policy_id, expiry_date)
);
CREATE TABLE IF NOT EXISTS public.insurance_claim_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), claim_id uuid NOT NULL REFERENCES public.insurance_claims(id) ON DELETE CASCADE, organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, status text NOT NULL, note text, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS public.insurance_commission_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), commission_id uuid NOT NULL REFERENCES public.insurance_commissions(id) ON DELETE CASCADE, organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, amount numeric(15,2) NOT NULL CHECK(amount > 0), received_at date NOT NULL DEFAULT current_date, reference text, reconciled boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.insurance_renewals ENABLE ROW LEVEL SECURITY; ALTER TABLE public.insurance_claim_updates ENABLE ROW LEVEL SECURITY; ALTER TABLE public.insurance_commission_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY insurance_org_renewals ON public.insurance_renewals FOR ALL TO authenticated USING(public.insurance_org_access(organization_id)) WITH CHECK(public.insurance_org_access(organization_id));
CREATE POLICY insurance_org_claim_updates ON public.insurance_claim_updates FOR ALL TO authenticated USING(public.insurance_org_access(organization_id)) WITH CHECK(public.insurance_org_access(organization_id));
CREATE POLICY insurance_org_commission_receipts ON public.insurance_commission_receipts FOR ALL TO authenticated USING(public.insurance_org_access(organization_id)) WITH CHECK(public.insurance_org_access(organization_id));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.insurance_renewals,public.insurance_claim_updates,public.insurance_commission_receipts TO authenticated;
