-- School desktop API compatibility fields.
-- These columns are used by the current school UI and are safe no-op additions for existing installs.

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS is_boarding boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_health_issue boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS photo_url text;

COMMENT ON COLUMN public.students.is_boarding IS 'True when the student is boarding/residential.';
COMMENT ON COLUMN public.students.has_health_issue IS 'Lightweight flag for school health follow-up.';
COMMENT ON COLUMN public.students.photo_url IS 'Optional student photo URL; file storage remains deployment-specific.';

ALTER TABLE public.teachers
  ADD COLUMN IF NOT EXISTS staff_type text,
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS role_assignment text,
  ADD COLUMN IF NOT EXISTS date_joined date;

CREATE INDEX IF NOT EXISTS idx_teachers_department ON public.teachers (organization_id, department_id);

COMMENT ON COLUMN public.teachers.staff_type IS 'Teaching / Non-Teaching or local staff category.';
COMMENT ON COLUMN public.teachers.department_id IS 'Optional department link for school staff.';
COMMENT ON COLUMN public.teachers.role_assignment IS 'Free-text role or assignment.';
COMMENT ON COLUMN public.teachers.date_joined IS 'Date the staff member joined the school.';
