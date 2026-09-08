-- Register VSLA as a selectable business type for platform org setup.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'business_types'
  ) THEN
    INSERT INTO public.business_types (code, name, is_active, sort_order)
    VALUES ('vsla', 'Villae Savings and Loan Association', true, 80)
    ON CONFLICT (code) DO UPDATE
      SET name = EXCLUDED.name,
          is_active = EXCLUDED.is_active;
  END IF;
END $$;
