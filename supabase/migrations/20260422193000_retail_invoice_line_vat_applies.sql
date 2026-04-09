-- Per-line VAT toggle for retail invoices (tax % applies only to lines with vat_applies = true)

ALTER TABLE public.retail_invoice_lines
  ADD COLUMN IF NOT EXISTS vat_applies boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.retail_invoice_lines.vat_applies IS
  'When true, this line amount is included in the VAT base (invoice tax_rate %).';
