-- Assessment UI: qualitative pain capture + lightweight report bookkeeping (path optional).

ALTER TABLE public.onboarding_assessments ADD COLUMN IF NOT EXISTS pain_point_1 text NOT NULL DEFAULT '';
ALTER TABLE public.onboarding_assessments ADD COLUMN IF NOT EXISTS pain_point_2 text NOT NULL DEFAULT '';
ALTER TABLE public.onboarding_assessments ADD COLUMN IF NOT EXISTS pain_point_3 text NOT NULL DEFAULT '';
ALTER TABLE public.onboarding_assessments ADD COLUMN IF NOT EXISTS report_generated_at timestamptz;
ALTER TABLE public.onboarding_assessments ADD COLUMN IF NOT EXISTS report_storage_path text;

COMMENT ON COLUMN public.onboarding_assessments.report_storage_path IS 'Optional Supabase Storage path once uploads are wired; client download flows may leave NULL.';
