-- School bursary and special fee structures

CREATE TABLE IF NOT EXISTS public.school_bursaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  academic_year text NOT NULL,
  term_name text NOT NULL,
  amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_bursaries_unique UNIQUE (organization_id, student_id, academic_year, term_name)
);

CREATE INDEX IF NOT EXISTS idx_school_bursaries_org_student
  ON public.school_bursaries (organization_id, student_id, academic_year, term_name);

CREATE TABLE IF NOT EXISTS public.school_special_fee_structures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  fee_type text NOT NULL CHECK (fee_type IN ('new_student','exam','uneb')),
  academic_year text NOT NULL,
  term_name text NOT NULL,
  amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_school_special_fee_org_term
  ON public.school_special_fee_structures (organization_id, fee_type, academic_year, term_name);

DROP TRIGGER IF EXISTS trg_set_org_school_bursaries ON public.school_bursaries;
CREATE TRIGGER trg_set_org_school_bursaries
BEFORE INSERT ON public.school_bursaries
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_school_special_fee_structures ON public.school_special_fee_structures;
CREATE TRIGGER trg_set_org_school_special_fee_structures
BEFORE INSERT ON public.school_special_fee_structures
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

CREATE OR REPLACE FUNCTION public.touch_school_bursaries_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_school_bursaries_touch ON public.school_bursaries;
CREATE TRIGGER trg_school_bursaries_touch
BEFORE UPDATE ON public.school_bursaries
FOR EACH ROW EXECUTE FUNCTION public.touch_school_bursaries_updated_at();

CREATE OR REPLACE FUNCTION public.touch_school_special_fee_structures_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_school_special_fee_structures_touch ON public.school_special_fee_structures;
CREATE TRIGGER trg_school_special_fee_structures_touch
BEFORE UPDATE ON public.school_special_fee_structures
FOR EACH ROW EXECUTE FUNCTION public.touch_school_special_fee_structures_updated_at();

ALTER TABLE public.school_bursaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_special_fee_structures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS school_bursaries_select_same_org ON public.school_bursaries;
CREATE POLICY school_bursaries_select_same_org
ON public.school_bursaries
FOR SELECT TO authenticated
USING (
  organization_id IS NOT NULL
  AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
);

DROP POLICY IF EXISTS school_bursaries_write_same_org ON public.school_bursaries;
CREATE POLICY school_bursaries_write_same_org
ON public.school_bursaries
FOR ALL TO authenticated
USING (
  organization_id IS NOT NULL
  AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
)
WITH CHECK (
  organization_id IS NOT NULL
  AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
);

DROP POLICY IF EXISTS school_special_fee_structures_select_same_org ON public.school_special_fee_structures;
CREATE POLICY school_special_fee_structures_select_same_org
ON public.school_special_fee_structures
FOR SELECT TO authenticated
USING (
  organization_id IS NOT NULL
  AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
);

DROP POLICY IF EXISTS school_special_fee_structures_write_same_org ON public.school_special_fee_structures;
CREATE POLICY school_special_fee_structures_write_same_org
ON public.school_special_fee_structures
FOR ALL TO authenticated
USING (
  organization_id IS NOT NULL
  AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
)
WITH CHECK (
  organization_id IS NOT NULL
  AND organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_bursaries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_special_fee_structures TO authenticated;

COMMENT ON TABLE public.school_bursaries IS 'Per-student fee reductions by term for automatic invoice deduction.';
COMMENT ON TABLE public.school_special_fee_structures IS 'Special fee structures for new students, exam fees, and UNEB fees.';
