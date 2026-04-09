-- School catalog: classes, streams, subjects, teachers (per-organization RLS).

CREATE TABLE IF NOT EXISTS public.classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT classes_org_name_unique UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_classes_org_sort ON public.classes (organization_id, sort_order, name);

CREATE TABLE IF NOT EXISTS public.streams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT streams_org_name_unique UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_streams_org_sort ON public.streams (organization_id, sort_order, name);

CREATE TABLE IF NOT EXISTS public.subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subjects_org_name_unique UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_subjects_org_sort ON public.subjects (organization_id, sort_order, name);

CREATE TABLE IF NOT EXISTS public.teachers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  email text,
  phone text,
  employee_number text,
  staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_teachers_org_name ON public.teachers (organization_id, lower(full_name));
CREATE UNIQUE INDEX IF NOT EXISTS teachers_org_employee_number_uq
  ON public.teachers (organization_id, employee_number)
  WHERE employee_number IS NOT NULL AND btrim(employee_number) <> '';

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS class_id uuid REFERENCES public.classes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stream_id uuid REFERENCES public.streams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_students_class ON public.students (organization_id, class_id);
CREATE INDEX IF NOT EXISTS idx_students_stream ON public.students (organization_id, stream_id);

ALTER TABLE public.fee_structures
  ADD COLUMN IF NOT EXISTS class_id uuid REFERENCES public.classes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stream_id uuid REFERENCES public.streams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_fee_structures_class ON public.fee_structures (organization_id, class_id);

-- Touch updated_at
CREATE OR REPLACE FUNCTION public.touch_classes_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION public.touch_streams_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION public.touch_subjects_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION public.touch_teachers_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_classes_touch ON public.classes;
CREATE TRIGGER trg_classes_touch BEFORE UPDATE ON public.classes
FOR EACH ROW EXECUTE FUNCTION public.touch_classes_updated_at();
DROP TRIGGER IF EXISTS trg_streams_touch ON public.streams;
CREATE TRIGGER trg_streams_touch BEFORE UPDATE ON public.streams
FOR EACH ROW EXECUTE FUNCTION public.touch_streams_updated_at();
DROP TRIGGER IF EXISTS trg_subjects_touch ON public.subjects;
CREATE TRIGGER trg_subjects_touch BEFORE UPDATE ON public.subjects
FOR EACH ROW EXECUTE FUNCTION public.touch_subjects_updated_at();
DROP TRIGGER IF EXISTS trg_teachers_touch ON public.teachers;
CREATE TRIGGER trg_teachers_touch BEFORE UPDATE ON public.teachers
FOR EACH ROW EXECUTE FUNCTION public.touch_teachers_updated_at();

DROP TRIGGER IF EXISTS trg_set_org_classes ON public.classes;
CREATE TRIGGER trg_set_org_classes BEFORE INSERT ON public.classes
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();
DROP TRIGGER IF EXISTS trg_set_org_streams ON public.streams;
CREATE TRIGGER trg_set_org_streams BEFORE INSERT ON public.streams
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();
DROP TRIGGER IF EXISTS trg_set_org_subjects ON public.subjects;
CREATE TRIGGER trg_set_org_subjects BEFORE INSERT ON public.subjects
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();
DROP TRIGGER IF EXISTS trg_set_org_teachers ON public.teachers;
CREATE TRIGGER trg_set_org_teachers BEFORE INSERT ON public.teachers
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;

DO $pol$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['classes', 'streams', 'subjects', 'teachers']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_select_same_org', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_write_same_org', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (
        organization_id IS NOT NULL AND organization_id = (
          SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
        )
      )',
      tbl || '_select_same_org',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (
        organization_id IS NOT NULL AND organization_id = (
          SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
        )
      ) WITH CHECK (
        organization_id IS NOT NULL AND organization_id = (
          SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
        )
      )',
      tbl || '_write_same_org',
      tbl
    );
  END LOOP;
END $pol$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.classes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.streams TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subjects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teachers TO authenticated;

COMMENT ON TABLE public.classes IS 'School class levels / forms (per organization).';
COMMENT ON TABLE public.streams IS 'Streams or tracks (e.g. Science, Arts) — per organization.';
COMMENT ON TABLE public.subjects IS 'Curriculum subjects offered.';
COMMENT ON TABLE public.teachers IS 'Teaching staff; optional link to BOAT staff for login.';
COMMENT ON COLUMN public.students.class_id IS 'Optional link to classes catalog; class_name may mirror name for reporting.';
COMMENT ON COLUMN public.students.stream_id IS 'Optional link to streams catalog.';
COMMENT ON COLUMN public.fee_structures.class_id IS 'Optional link to classes; class_name retained for labels.';
