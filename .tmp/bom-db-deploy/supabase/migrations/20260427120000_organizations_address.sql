-- Optional mailing/campus address for receipts and documents (school, retail, etc.)
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS address text;

COMMENT ON COLUMN public.organizations.address IS 'Optional address shown on receipts and PDFs.';
