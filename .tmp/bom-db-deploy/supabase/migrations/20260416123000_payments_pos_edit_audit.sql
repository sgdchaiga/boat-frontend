-- Track manual edits on posted POS payments.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS edited_by_staff_id uuid REFERENCES public.staff(id),
  ADD COLUMN IF NOT EXISTS edited_by_name text;

CREATE INDEX IF NOT EXISTS idx_payments_edited_at ON public.payments(edited_at);
-- Track manual edits on posted POS payments.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS edited_by_staff_id uuid REFERENCES public.staff(id),
  ADD COLUMN IF NOT EXISTS edited_by_name text;

CREATE INDEX IF NOT EXISTS idx_payments_edited_at ON public.payments(edited_at);
