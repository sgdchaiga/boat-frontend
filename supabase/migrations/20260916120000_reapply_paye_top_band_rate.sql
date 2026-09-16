-- Catch standard PAYE configurations whose JSON formatting differed from the
-- earlier correction migration, without overwriting deliberately custom bands.
UPDATE public.payroll_org_settings
SET paye_tax_bands = jsonb_set(
  paye_tax_bands,
  '{4}',
  jsonb_build_object('lower', 10000000, 'upper', null, 'ratePct', 10, 'minimumTax', 2888250)
), updated_at = now()
WHERE jsonb_array_length(paye_tax_bands) = 5
  AND paye_tax_bands->4->>'lower' = '10000000'
  AND (
    paye_tax_bands->4->>'ratePct' = '40'
    OR paye_tax_bands->4->>'minimumTax' = '2902000'
  );
