CREATE TABLE IF NOT EXISTS public.sacco_monthly_provision_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  reporting_month date NOT NULL, interest_receivable numeric NOT NULL DEFAULT 0, interest_unreceived numeric NOT NULL DEFAULT 0,
  principal_outstanding numeric NOT NULL DEFAULT 0, total_outstanding numeric NOT NULL DEFAULT 0, amount_in_arrears numeric NOT NULL DEFAULT 0,
  par_1_percent numeric NOT NULL DEFAULT 0, par_30_percent numeric NOT NULL DEFAULT 0, specific_provision numeric NOT NULL DEFAULT 0,
  general_provision numeric NOT NULL DEFAULT 0, monthly_provision numeric NOT NULL DEFAULT 0, total_provision numeric NOT NULL DEFAULT 0,
  policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb, created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id, reporting_month)
);
ALTER TABLE public.sacco_monthly_provision_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY sacco_provision_snapshots_org ON public.sacco_monthly_provision_snapshots FOR ALL TO authenticated
  USING (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()))
  WITH CHECK (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.sacco_monthly_provision_snapshots TO authenticated;
