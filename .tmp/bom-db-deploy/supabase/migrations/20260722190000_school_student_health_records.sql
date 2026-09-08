CREATE TABLE IF NOT EXISTS public.school_student_health_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  condition_name text NOT NULL,
  allergies text,
  medication text,
  emergency_action text,
  notes text,
  recorded_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_school_student_health_org_student ON public.school_student_health_records(organization_id, student_id);
ALTER TABLE public.school_student_health_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS school_student_health_tenant_access ON public.school_student_health_records;
CREATE POLICY school_student_health_tenant_access ON public.school_student_health_records FOR ALL TO authenticated
USING (
  public.is_platform_admin()
  OR (
    public.auth_staff_org_id() IS NOT NULL
    AND organization_id = public.auth_staff_org_id()
  )
)
WITH CHECK (
  public.is_platform_admin()
  OR (
    public.auth_staff_org_id() IS NOT NULL
    AND organization_id = public.auth_staff_org_id()
  )
);
