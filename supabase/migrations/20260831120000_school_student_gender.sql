-- Student gender supports enrollment statistics and demographic reporting.
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS gender text;

CREATE INDEX IF NOT EXISTS idx_students_org_gender
  ON public.students (organization_id, gender);

COMMENT ON COLUMN public.students.gender IS 'Student gender used for school demographic and enrollment reporting.';
