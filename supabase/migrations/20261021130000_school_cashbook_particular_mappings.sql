CREATE TABLE IF NOT EXISTS public.school_cashbook_particular_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  original_account text NOT NULL,
  school_subvote_id uuid NOT NULL REFERENCES public.school_budget_subvotes(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, original_account)
);
CREATE INDEX IF NOT EXISTS school_cashbook_particular_mappings_lookup ON public.school_cashbook_particular_mappings(organization_id, lower(original_account));
ALTER TABLE public.school_cashbook_particular_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY school_cashbook_particular_mappings_org ON public.school_cashbook_particular_mappings
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.staff s WHERE s.id=auth.uid() AND s.organization_id=organization_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.staff s WHERE s.id=auth.uid() AND s.organization_id=organization_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_cashbook_particular_mappings TO authenticated;
