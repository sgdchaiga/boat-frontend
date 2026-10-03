INSERT INTO storage.buckets (id, name, public) VALUES ('insurance-kyc', 'insurance-kyc', false) ON CONFLICT (id) DO NOTHING;
CREATE POLICY insurance_kyc_org_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id='insurance-kyc' AND public.insurance_org_access((storage.foldername(name))[1]::uuid));
CREATE POLICY insurance_kyc_org_write ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='insurance-kyc' AND public.insurance_org_access((storage.foldername(name))[1]::uuid));
