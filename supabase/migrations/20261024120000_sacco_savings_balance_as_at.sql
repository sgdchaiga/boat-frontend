-- Preserve the reporting cut-off of opening/bulk balance snapshots.
-- This is intentionally separate from a cash transaction's posting date.
ALTER TABLE public.sacco_member_savings_accounts
  ADD COLUMN IF NOT EXISTS balance_as_at date;

COMMENT ON COLUMN public.sacco_member_savings_accounts.balance_as_at IS
  'As-at/effective reporting date of the latest opening or bulk balance snapshot; not a cash transaction date.';
