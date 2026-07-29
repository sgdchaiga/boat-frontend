-- Tenant-managed school branding used on printed documents.

-- Keep the payment-method constraint in sync even when this migration is
-- applied without the earlier school biodata/SchoolPay migration.
ALTER TABLE public.school_payments
  DROP CONSTRAINT IF EXISTS school_payments_method_check;
ALTER TABLE public.school_payments
  ADD CONSTRAINT school_payments_method_check
  CHECK (method IN ('cash', 'mobile_money', 'bank', 'transfer', 'school_pay', 'other', 'wallet'));

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('organization-branding', 'organization-branding', true, 3145728, ARRAY['image/png','image/jpeg','image/webp','image/svg+xml'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 3145728;

DROP POLICY IF EXISTS organization_branding_read ON storage.objects;
CREATE POLICY organization_branding_read ON storage.objects FOR SELECT USING (bucket_id = 'organization-branding');
DROP POLICY IF EXISTS organization_branding_write ON storage.objects;
CREATE POLICY organization_branding_write ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'organization-branding' AND (storage.foldername(name))[1] = public.staff_organization_id_text())
WITH CHECK (bucket_id = 'organization-branding' AND (storage.foldername(name))[1] = public.staff_organization_id_text());

CREATE OR REPLACE FUNCTION public.save_school_organization_profile(p_name text, p_address text, p_logo_url text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE oid uuid;
BEGIN
  SELECT organization_id INTO oid FROM public.staff WHERE id = auth.uid();
  IF oid IS NULL THEN RAISE EXCEPTION 'No organization for current user'; END IF;
  IF NULLIF(trim(p_name), '') IS NULL THEN RAISE EXCEPTION 'School name is required'; END IF;
  UPDATE public.organizations SET name=trim(p_name), address=NULLIF(trim(p_address),''), logo_url=NULLIF(trim(p_logo_url),'') WHERE id=oid;
END; $$;
REVOKE ALL ON FUNCTION public.save_school_organization_profile(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_school_organization_profile(text,text,text) TO authenticated;
