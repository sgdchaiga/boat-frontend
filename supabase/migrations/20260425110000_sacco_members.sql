-- SACCO members registry (per organization)

CREATE TABLE IF NOT EXISTS public.sacco_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  member_number text NOT NULL,
  full_name text NOT NULL,
  email text,
  phone text,
  national_id text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sacco_members_org_member_number_unique UNIQUE (organization_id, member_number)
);

CREATE INDEX IF NOT EXISTS idx_sacco_members_org_name ON public.sacco_members (organization_id, lower(full_name));
CREATE INDEX IF NOT EXISTS idx_sacco_members_org_active ON public.sacco_members (organization_id, is_active);

CREATE OR REPLACE FUNCTION public.touch_sacco_members_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sacco_members_touch_updated ON public.sacco_members;
CREATE TRIGGER trg_sacco_members_touch_updated
BEFORE UPDATE ON public.sacco_members
FOR EACH ROW
EXECUTE FUNCTION public.touch_sacco_members_updated_at();

DROP TRIGGER IF EXISTS trg_set_org_sacco_members ON public.sacco_members;
CREATE TRIGGER trg_set_org_sacco_members
BEFORE INSERT ON public.sacco_members
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

ALTER TABLE public.sacco_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sacco_members_select_same_org" ON public.sacco_members;
DROP POLICY IF EXISTS "sacco_members_write_same_org" ON public.sacco_members;

CREATE POLICY "sacco_members_select_same_org"
  ON public.sacco_members FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

CREATE POLICY "sacco_members_write_same_org"
  ON public.sacco_members FOR ALL
  TO authenticated
  USING (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

COMMENT ON TABLE public.sacco_members IS 'SACCO member register: member number, contact details, active flag.';

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sacco_members TO authenticated;
GRANT ALL ON TABLE public.sacco_members TO service_role;
