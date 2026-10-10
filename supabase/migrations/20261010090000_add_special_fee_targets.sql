ALTER TABLE public.school_special_fee_structures
  ADD COLUMN IF NOT EXISTS target_class_id uuid REFERENCES public.classes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS charge_date date,
  ADD COLUMN IF NOT EXISTS reference text;

CREATE INDEX IF NOT EXISTS idx_school_special_fee_target_class
  ON public.school_special_fee_structures (organization_id, target_class_id, academic_year, term_name);

COMMENT ON COLUMN public.school_special_fee_structures.target_class_id IS 'Optional class restriction; null applies to every class.';
COMMENT ON COLUMN public.school_special_fee_structures.charge_date IS 'The date shown for this special charge.';
