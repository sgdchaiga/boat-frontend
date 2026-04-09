-- Attach receipts / source files to incoming payments, vendor payments, and expenses.
-- Stored as JSON array: [{"path":"org_id/...","name":"receipt.pdf"}, ...]
-- Files live in storage bucket `source-documents` (see policies below).

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS source_documents jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.vendor_payments
  ADD COLUMN IF NOT EXISTS source_documents jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS source_documents jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.payments.source_documents IS 'Attached files: [{path, name}] paths in storage bucket source-documents';
COMMENT ON COLUMN public.vendor_payments.source_documents IS 'Attached files: [{path, name}] paths in storage bucket source-documents';
COMMENT ON COLUMN public.expenses.source_documents IS 'Attached files: [{path, name}] paths in storage bucket source-documents';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'source-documents',
  'source-documents',
  false,
  52428800,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "source_documents_authenticated_all" ON storage.objects;
CREATE POLICY "source_documents_authenticated_all"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (bucket_id = 'source-documents')
  WITH CHECK (bucket_id = 'source-documents');
