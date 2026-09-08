-- SACCO branches (codes used in savings account number branch segment).
CREATE TABLE IF NOT EXISTS public.sacco_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sacco_branches_org_code_unique UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_sacco_branches_org ON public.sacco_branches (organization_id);

ALTER TABLE public.sacco_branches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sacco_branches_org" ON public.sacco_branches;
CREATE POLICY "sacco_branches_org"
  ON public.sacco_branches FOR ALL TO authenticated
  USING (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
  WITH CHECK (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sacco_branches TO authenticated;
GRANT ALL ON public.sacco_branches TO service_role;

CREATE OR REPLACE FUNCTION public.touch_sacco_branches_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_sacco_branches_touch ON public.sacco_branches;
CREATE TRIGGER trg_sacco_branches_touch
BEFORE UPDATE ON public.sacco_branches
FOR EACH ROW EXECUTE FUNCTION public.touch_sacco_branches_updated_at();

COMMENT ON TABLE public.sacco_branches IS 'SACCO branch codes for savings account numbering (branch segment).';

ALTER TABLE public.sacco_member_savings_accounts
  ADD COLUMN IF NOT EXISTS branch_code text;

COMMENT ON COLUMN public.sacco_member_savings_accounts.branch_code IS 'Branch code used when account number was issued (branch segment).';

-- One default branch per org from existing account number settings (branch_value).
INSERT INTO public.sacco_branches (organization_id, code, name, description, is_active, is_default, sort_order)
SELECT
  s.organization_id,
  regexp_replace(COALESCE(NULLIF(trim(s.branch_value), ''), '1'), '\D', '', 'g') AS code,
  'Main branch' AS name,
  'Migrated from savings account number settings' AS description,
  true,
  true,
  0
FROM public.sacco_account_number_settings s
WHERE regexp_replace(COALESCE(NULLIF(trim(s.branch_value), ''), '1'), '\D', '', 'g') <> ''
ON CONFLICT (organization_id, code) DO NOTHING;
