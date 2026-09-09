-- Preserve payment identifiers and the named recipient on imported expenses.
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS payee_name text,
  ADD COLUMN IF NOT EXISTS cheque_number text,
  ADD COLUMN IF NOT EXISTS voucher_number text;
