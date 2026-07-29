-- Financial Modelling Studio is a dedicated BOAT business segment. It is not
-- an operational module attached to hotel, retail, SACCO, school, or other tenants.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'business_types'
  ) THEN
    INSERT INTO public.business_types (code, name, is_active, sort_order)
    VALUES ('financial_modelling', 'Financial Modelling Studio', true, 95)
    ON CONFLICT (code) DO UPDATE
      SET name = EXCLUDED.name, is_active = true;
  END IF;
END $$;
