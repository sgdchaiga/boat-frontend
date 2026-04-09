-- Member register: profile / KYC fields (moved from savings account opening form).

ALTER TABLE public.sacco_members
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS marital_status text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS occupation text,
  ADD COLUMN IF NOT EXISTS next_of_kin text,
  ADD COLUMN IF NOT EXISTS nok_phone text;

COMMENT ON COLUMN public.sacco_members.address IS 'Residential / mailing address.';
COMMENT ON COLUMN public.sacco_members.next_of_kin IS 'Next of kin name.';
COMMENT ON COLUMN public.sacco_members.nok_phone IS 'Next of kin telephone.';
