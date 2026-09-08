-- Clinic / pharmacy: patient register and consultations (tenant-scoped, retail-style orgs).

CREATE TABLE IF NOT EXISTS public.clinic_patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  patient_number text NOT NULL,
  name text NOT NULL,
  gender text,
  age text,
  phone text,
  address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, patient_number)
);

CREATE INDEX IF NOT EXISTS idx_clinic_patients_org_lower_name ON public.clinic_patients(organization_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_clinic_patients_org_created ON public.clinic_patients(organization_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_set_org_clinic_patients ON public.clinic_patients;
CREATE TRIGGER trg_set_org_clinic_patients
BEFORE INSERT ON public.clinic_patients
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

CREATE OR REPLACE FUNCTION public.touch_clinic_patients_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clinic_patients_touch_updated ON public.clinic_patients;
CREATE TRIGGER trg_clinic_patients_touch_updated
BEFORE UPDATE ON public.clinic_patients
FOR EACH ROW
EXECUTE FUNCTION public.touch_clinic_patients_updated_at();

CREATE TABLE IF NOT EXISTS public.clinic_consultations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.clinic_patients(id) ON DELETE CASCADE,
  symptoms text,
  diagnosis text,
  prescription text,
  notes text,
  workflow_step text NOT NULL DEFAULT 'reception'
    CHECK (workflow_step IN ('reception', 'doctor', 'pharmacy', 'payment')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clinic_consultations_org_patient ON public.clinic_consultations(organization_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_clinic_consultations_org_updated ON public.clinic_consultations(organization_id, updated_at DESC);

-- organization_id is supplied by the app (same as staff org); validate against patient row.
CREATE OR REPLACE FUNCTION public.clinic_consultations_check_patient_org()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  p_org uuid;
BEGIN
  SELECT organization_id INTO p_org FROM public.clinic_patients WHERE id = NEW.patient_id;
  IF p_org IS NULL THEN
    RAISE EXCEPTION 'clinic_consultations: patient not found';
  END IF;
  IF p_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'clinic_consultations: patient organization mismatch';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clinic_consultations_check_patient ON public.clinic_consultations;
CREATE TRIGGER trg_clinic_consultations_check_patient
BEFORE INSERT OR UPDATE OF patient_id, organization_id ON public.clinic_consultations
FOR EACH ROW
EXECUTE FUNCTION public.clinic_consultations_check_patient_org();

CREATE OR REPLACE FUNCTION public.touch_clinic_consultations_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clinic_consultations_touch_updated ON public.clinic_consultations;
CREATE TRIGGER trg_clinic_consultations_touch_updated
BEFORE UPDATE ON public.clinic_consultations
FOR EACH ROW
EXECUTE FUNCTION public.touch_clinic_consultations_updated_at();

ALTER TABLE public.clinic_patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_consultations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clinic_patients_select_same_org" ON public.clinic_patients;
DROP POLICY IF EXISTS "clinic_patients_write_same_org" ON public.clinic_patients;
DROP POLICY IF EXISTS "clinic_consultations_select_same_org" ON public.clinic_consultations;
DROP POLICY IF EXISTS "clinic_consultations_write_same_org" ON public.clinic_consultations;

CREATE POLICY "clinic_patients_select_same_org"
  ON public.clinic_patients FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

CREATE POLICY "clinic_patients_write_same_org"
  ON public.clinic_patients FOR ALL
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

CREATE POLICY "clinic_consultations_select_same_org"
  ON public.clinic_consultations FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

CREATE POLICY "clinic_consultations_write_same_org"
  ON public.clinic_consultations FOR ALL
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

COMMENT ON TABLE public.clinic_patients IS 'Simple clinic/pharmacy patient register (per organization).';
COMMENT ON TABLE public.clinic_consultations IS 'Consultation notes and reception→doctor→pharmacy→payment workflow.';
