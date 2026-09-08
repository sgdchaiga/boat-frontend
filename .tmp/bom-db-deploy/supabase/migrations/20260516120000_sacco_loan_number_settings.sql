-- Loan account numbers: branch + loan product code + serial (per org), parallel to savings account format.

CREATE TABLE IF NOT EXISTS public.sacco_loan_number_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_digit_count int NOT NULL DEFAULT 2
    CHECK (branch_digit_count >= 1 AND branch_digit_count <= 12),
  loan_code_digit_count int NOT NULL DEFAULT 2
    CHECK (loan_code_digit_count >= 1 AND loan_code_digit_count <= 12),
  serial_digit_count int NOT NULL DEFAULT 5
    CHECK (serial_digit_count >= 1 AND serial_digit_count <= 12),
  branch_value text NOT NULL DEFAULT '1',
  loan_code_value text NOT NULL DEFAULT '1',
  separator text NOT NULL DEFAULT '-',
  segment_order text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.touch_sacco_loan_number_settings_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_sacco_loan_number_settings_touch ON public.sacco_loan_number_settings;
CREATE TRIGGER trg_sacco_loan_number_settings_touch
BEFORE UPDATE ON public.sacco_loan_number_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_sacco_loan_number_settings_updated_at();

ALTER TABLE public.sacco_loan_number_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sacco_loan_num_settings_org" ON public.sacco_loan_number_settings;
CREATE POLICY "sacco_loan_num_settings_org"
  ON public.sacco_loan_number_settings FOR ALL TO authenticated
  USING (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
  WITH CHECK (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sacco_loan_number_settings TO authenticated;
GRANT ALL ON public.sacco_loan_number_settings TO service_role;

COMMENT ON TABLE public.sacco_loan_number_settings IS 'Loan reference number format: branch + loan product code + serial.';

-- Product-short code used in the middle segment of loan_number (editable per loan product).
ALTER TABLE public.sacco_loan_products
  ADD COLUMN IF NOT EXISTS loan_code text NOT NULL DEFAULT '1';

COMMENT ON COLUMN public.sacco_loan_products.loan_code IS 'Numeric code for loan number middle segment; padded per sacco_loan_number_settings.loan_code_digit_count.';

-- Distinct codes for existing products (were all default '1').
UPDATE public.sacco_loan_products p
SET loan_code = LPAD(x.rn::text, 2, '0')
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY organization_id ORDER BY sort_order, name) AS rn
  FROM public.sacco_loan_products
) x
WHERE p.id = x.id;

ALTER TABLE public.sacco_loans
  ADD COLUMN IF NOT EXISTS loan_number text;

COMMENT ON COLUMN public.sacco_loans.loan_number IS 'Structured loan reference: branch + loan_code + serial per sacco_loan_number_settings.';

DROP INDEX IF EXISTS idx_sacco_loans_org_loan_number_unique;
CREATE UNIQUE INDEX idx_sacco_loans_org_loan_number_unique
  ON public.sacco_loans (organization_id, loan_number)
  WHERE loan_number IS NOT NULL AND trim(loan_number) <> '';
