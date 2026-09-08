-- Detail fields for budget lines: unit, recurrence frequency, quantity, unit price.
-- Line `amount` remains the budget total (used for GL variance); it can be set manually
-- or derived as quantity * unit_price * period multiplier for the budget dates.

ALTER TABLE public.budget_lines
  ADD COLUMN IF NOT EXISTS unit text,
  ADD COLUMN IF NOT EXISTS frequency text NOT NULL DEFAULT 'one_time',
  ADD COLUMN IF NOT EXISTS quantity numeric(18, 4),
  ADD COLUMN IF NOT EXISTS unit_price numeric(18, 2);

COMMENT ON COLUMN public.budget_lines.unit IS 'Unit of measure (e.g. hours, kg, each).';
COMMENT ON COLUMN public.budget_lines.frequency IS 'Recurrence: one_time, monthly, quarterly, semi_annual, annual.';
COMMENT ON COLUMN public.budget_lines.quantity IS 'Quantity per period at unit_price (optional; amount may be entered directly).';
COMMENT ON COLUMN public.budget_lines.unit_price IS 'Cost or price per unit before frequency scaling.';
