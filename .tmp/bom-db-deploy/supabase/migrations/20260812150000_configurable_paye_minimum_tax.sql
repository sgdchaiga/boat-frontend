ALTER TABLE public.payroll_org_settings
  ALTER COLUMN paye_tax_bands SET DEFAULT '[
    {"lower":0,"upper":235000,"ratePct":0,"minimumTax":0},
    {"lower":235000,"upper":335000,"ratePct":10,"minimumTax":0},
    {"lower":335000,"upper":410000,"ratePct":20,"minimumTax":10000},
    {"lower":410000,"upper":10000000,"ratePct":30,"minimumTax":25000},
    {"lower":10000000,"upper":null,"ratePct":40,"minimumTax":2902000}
  ]'::jsonb;

-- Upgrade existing/custom bands without changing their effective progressive tax.
DO $$
DECLARE
  settings_row record;
  band jsonb;
  upgraded jsonb;
  inferred_minimum numeric;
  band_minimum numeric;
BEGIN
  FOR settings_row IN SELECT organization_id, paye_tax_bands FROM public.payroll_org_settings
  LOOP
    upgraded := '[]'::jsonb;
    inferred_minimum := 0;
    FOR band IN SELECT value FROM jsonb_array_elements(settings_row.paye_tax_bands)
    LOOP
      band_minimum := COALESCE((band->>'minimumTax')::numeric, inferred_minimum);
      upgraded := upgraded || jsonb_build_array(band || jsonb_build_object('minimumTax', band_minimum));
      IF band->>'upper' IS NOT NULL THEN
        inferred_minimum := band_minimum
          + (((band->>'upper')::numeric - (band->>'lower')::numeric) * (band->>'ratePct')::numeric / 100);
      END IF;
    END LOOP;
    UPDATE public.payroll_org_settings
    SET paye_tax_bands = upgraded
    WHERE organization_id = settings_row.organization_id;
  END LOOP;
END $$;

COMMENT ON COLUMN public.payroll_org_settings.paye_tax_bands IS
  'Organization-editable PAYE bands on gross pay: lower, upper, ratePct, and minimumTax payable at the band lower edge.';
