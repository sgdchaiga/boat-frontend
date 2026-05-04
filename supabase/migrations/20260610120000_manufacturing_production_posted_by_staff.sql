-- Add posted_by_staff_id if manufacturing_production_entries already existed from an older
-- manufacturing_module migration (CREATE TABLE IF NOT EXISTS does not add new columns).

ALTER TABLE public.manufacturing_production_entries
  ADD COLUMN IF NOT EXISTS posted_by_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.manufacturing_production_entries.posted_by_staff_id IS
  'Staff member responsible for the production entry (shown on daily production reports).';
