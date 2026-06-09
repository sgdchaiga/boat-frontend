ALTER TABLE public.expense_lines
  ADD COLUMN IF NOT EXISTS quantity numeric(15, 3) NOT NULL DEFAULT 1 CHECK (quantity > 0);

COMMENT ON COLUMN public.expense_lines.quantity IS 'Informational purchased quantity for Spend Money reporting; amount remains the total line amount.';
