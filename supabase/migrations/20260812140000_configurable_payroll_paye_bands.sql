ALTER TABLE public.payroll_org_settings
  ADD COLUMN IF NOT EXISTS paye_tax_bands jsonb NOT NULL DEFAULT '[
    {"lower":0,"upper":235000,"ratePct":0},
    {"lower":235000,"upper":335000,"ratePct":10},
    {"lower":335000,"upper":410000,"ratePct":20},
    {"lower":410000,"upper":10000000,"ratePct":30},
    {"lower":10000000,"upper":null,"ratePct":40}
  ]'::jsonb;

COMMENT ON COLUMN public.payroll_org_settings.paye_tax_bands IS
  'Organization-editable progressive PAYE bands on gross pay. Each item has lower, upper (null for final band), and ratePct.';
