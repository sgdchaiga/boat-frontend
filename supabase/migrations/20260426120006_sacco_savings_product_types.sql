-- Savings product / account types (code + name) for members & numbering.
CREATE TABLE IF NOT EXISTS public.sacco_savings_product_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sacco_savings_pt_org_code_unique UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_sacco_savings_pt_org ON public.sacco_savings_product_types (organization_id);

ALTER TABLE public.sacco_savings_product_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sacco_savings_pt_org" ON public.sacco_savings_product_types;
CREATE POLICY "sacco_savings_pt_org"
  ON public.sacco_savings_product_types FOR ALL TO authenticated
  USING (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
  WITH CHECK (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sacco_savings_product_types TO authenticated;
GRANT ALL ON public.sacco_savings_product_types TO service_role;

CREATE OR REPLACE FUNCTION public.touch_sacco_savings_pt_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_sacco_savings_pt_touch ON public.sacco_savings_product_types;
CREATE TRIGGER trg_sacco_savings_pt_touch
BEFORE UPDATE ON public.sacco_savings_product_types
FOR EACH ROW EXECUTE FUNCTION public.touch_sacco_savings_pt_updated_at();

COMMENT ON TABLE public.sacco_savings_product_types IS 'Savings account product types (codes) for SACCO members; used when opening accounts.';
