-- Correct the configurable PAYE default above UGX 10,000,000:
-- 33,750 + 30% × (income − 485,000) + 10% × (income − 10,000,000).
-- Only replace the former system default; organizations that deliberately edited
-- their tax bands keep their own configuration.
UPDATE public.payroll_org_settings
SET paye_tax_bands = jsonb_build_array(
  jsonb_build_object('lower', 0, 'upper', 235000, 'ratePct', 0, 'minimumTax', 0),
  jsonb_build_object('lower', 235000, 'upper', 335000, 'ratePct', 10, 'minimumTax', 0),
  jsonb_build_object('lower', 335000, 'upper', 410000, 'ratePct', 20, 'minimumTax', 10000),
  jsonb_build_object('lower', 410000, 'upper', 10000000, 'ratePct', 30, 'minimumTax', 25000),
  jsonb_build_object('lower', 10000000, 'upper', null, 'ratePct', 10, 'minimumTax', 2888250)
), updated_at = now()
WHERE paye_tax_bands = jsonb_build_array(
  jsonb_build_object('lower', 0, 'upper', 235000, 'ratePct', 0, 'minimumTax', 0),
  jsonb_build_object('lower', 235000, 'upper', 335000, 'ratePct', 10, 'minimumTax', 0),
  jsonb_build_object('lower', 335000, 'upper', 410000, 'ratePct', 20, 'minimumTax', 10000),
  jsonb_build_object('lower', 410000, 'upper', 10000000, 'ratePct', 30, 'minimumTax', 25000),
  jsonb_build_object('lower', 10000000, 'upper', null, 'ratePct', 40, 'minimumTax', 2902000)
);
