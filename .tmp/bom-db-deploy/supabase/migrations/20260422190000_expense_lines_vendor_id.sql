-- Optional supplier per expense line (independent of expenses.vendor_id header).
ALTER TABLE public.expense_lines
  ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expense_lines_vendor ON public.expense_lines(vendor_id);

COMMENT ON COLUMN public.expense_lines.vendor_id IS 'Optional vendor for this line';
