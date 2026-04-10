-- Optional file attachment for VSLA meeting minutes (path in private storage bucket vsla-meeting-minutes).

ALTER TABLE public.vsla_meetings
  ADD COLUMN IF NOT EXISTS minutes_attachment_path text,
  ADD COLUMN IF NOT EXISTS minutes_attachment_name text;

COMMENT ON COLUMN public.vsla_meetings.minutes_attachment_path IS 'Object path in storage bucket vsla-meeting-minutes';
COMMENT ON COLUMN public.vsla_meetings.minutes_attachment_name IS 'Original filename for display';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vsla-meeting-minutes',
  'vsla-meeting-minutes',
  false,
  52428800,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/csv'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "vsla_meeting_minutes_authenticated_all" ON storage.objects;
CREATE POLICY "vsla_meeting_minutes_authenticated_all"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (bucket_id = 'vsla-meeting-minutes')
  WITH CHECK (bucket_id = 'vsla-meeting-minutes');
