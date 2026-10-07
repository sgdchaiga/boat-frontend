-- Verified student name variants used only for school-payment statement matching.
CREATE TABLE IF NOT EXISTS public.school_student_name_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  alias text NOT NULL CHECK (length(trim(alias)) > 0),
  normalized_alias text NOT NULL CHECK (length(trim(normalized_alias)) > 0),
  verified_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, student_id, normalized_alias)
);

CREATE INDEX IF NOT EXISTS idx_school_student_name_aliases_lookup
  ON public.school_student_name_aliases (organization_id, normalized_alias);

ALTER TABLE public.school_student_name_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS school_student_name_aliases_same_org ON public.school_student_name_aliases;
CREATE POLICY school_student_name_aliases_same_org
  ON public.school_student_name_aliases FOR ALL TO authenticated
  USING (
    public.is_platform_admin()
    OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
  )
  WITH CHECK (
    public.is_platform_admin()
    OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_student_name_aliases TO authenticated;

COMMENT ON TABLE public.school_student_name_aliases IS
  'Verified student aliases for payment statement matching. Payer names must not be stored here.';
