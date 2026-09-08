-- Persist finalized hotel assessment PDFs (Supabase Storage) for reproducible downloads.
-- Object path convention: `{organization_id}/{assessment_id}.pdf` inside bucket `hotel-assessment-reports`.
-- Mirrors `onboarding_assessments.report_storage_path`.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'hotel-assessment-reports',
  'hotel-assessment-reports',
  false,
  15728640,
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Scoped to the signed-in staff member's organization (first path segment).
CREATE OR REPLACE FUNCTION public.staff_organization_id_text()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.organization_id::text
  FROM public.staff s
  WHERE s.id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.staff_organization_id_text() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_organization_id_text() TO authenticated;

DROP POLICY IF EXISTS "hotel_assessment_reports_select_org" ON storage.objects;
DROP POLICY IF EXISTS "hotel_assessment_reports_insert_org" ON storage.objects;
DROP POLICY IF EXISTS "hotel_assessment_reports_update_org" ON storage.objects;
DROP POLICY IF EXISTS "hotel_assessment_reports_delete_org" ON storage.objects;

CREATE POLICY "hotel_assessment_reports_select_org"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'hotel-assessment-reports'
    AND (storage.foldername(name))[1] = public.staff_organization_id_text()
  );

CREATE POLICY "hotel_assessment_reports_insert_org"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'hotel-assessment-reports'
    AND (storage.foldername(name))[1] = public.staff_organization_id_text()
  );

CREATE POLICY "hotel_assessment_reports_update_org"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'hotel-assessment-reports'
    AND (storage.foldername(name))[1] = public.staff_organization_id_text()
  )
  WITH CHECK (
    bucket_id = 'hotel-assessment-reports'
    AND (storage.foldername(name))[1] = public.staff_organization_id_text()
  );

CREATE POLICY "hotel_assessment_reports_delete_org"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'hotel-assessment-reports'
    AND (storage.foldername(name))[1] = public.staff_organization_id_text()
  );
