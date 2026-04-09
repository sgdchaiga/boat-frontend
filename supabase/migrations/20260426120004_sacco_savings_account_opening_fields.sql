-- Savings account opening register: KYC-style snapshot + audit (Posted By / Edited By).

DROP INDEX IF EXISTS public.sacco_savings_acct_member_product_unique;

ALTER TABLE public.sacco_member_savings_accounts
  ADD COLUMN IF NOT EXISTS date_account_opened date NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS client_no text,
  ADD COLUMN IF NOT EXISTS client_full_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS marital_status text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS telephone text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS occupation text,
  ADD COLUMN IF NOT EXISTS next_of_kin text,
  ADD COLUMN IF NOT EXISTS nok_phone text,
  ADD COLUMN IF NOT EXISTS sub_account text,
  ADD COLUMN IF NOT EXISTS posted_by_staff_id uuid,
  ADD COLUMN IF NOT EXISTS posted_by_name text,
  ADD COLUMN IF NOT EXISTS edited_by_staff_id uuid,
  ADD COLUMN IF NOT EXISTS edited_by_name text;

-- One row per member + product code + sub-account label (e.g. same product, different sub-account).
CREATE UNIQUE INDEX IF NOT EXISTS sacco_savings_acct_member_product_sub_unique
  ON public.sacco_member_savings_accounts (sacco_member_id, savings_product_code, (COALESCE(sub_account, '')));

COMMENT ON COLUMN public.sacco_member_savings_accounts.date_account_opened IS 'Date the savings account was opened.';
COMMENT ON COLUMN public.sacco_member_savings_accounts.client_no IS 'Member / client number (copy of member_number at opening).';
COMMENT ON COLUMN public.sacco_member_savings_accounts.client_full_name IS 'Account holder name at opening.';
COMMENT ON COLUMN public.sacco_member_savings_accounts.sub_account IS 'Sub-account label (e.g. product variant).';
COMMENT ON COLUMN public.sacco_member_savings_accounts.posted_by_staff_id IS 'auth user id at creation (typically matches staff.id).';
