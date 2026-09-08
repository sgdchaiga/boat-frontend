-- Repair hosted databases where the historical attachment migration was
-- recorded in the migration ledger without its table changes being present.
ALTER TABLE public.vsla_meetings
  ADD COLUMN IF NOT EXISTS minutes_attachment_path text,
  ADD COLUMN IF NOT EXISTS minutes_attachment_name text;

COMMENT ON COLUMN public.vsla_meetings.minutes_attachment_path IS
  'Object path in storage bucket vsla-meeting-minutes';
COMMENT ON COLUMN public.vsla_meetings.minutes_attachment_name IS
  'Original filename for display';

NOTIFY pgrst, 'reload schema';
