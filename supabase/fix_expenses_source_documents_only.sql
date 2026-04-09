-- Quick fix if only `expenses.source_documents` is missing (run in Supabase SQL Editor).
-- For full attachments + storage bucket, use: migrations/20260328000000_source_documents_attachments.sql

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS source_documents jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.expenses.source_documents IS 'Attached files: [{path, name, url?, refOnly?}] — see app sourceDocuments.ts';
