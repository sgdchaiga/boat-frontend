-- Absence deductions: working days per month (org default) and per-line days absent + amount

ALTER TABLE public.payroll_org_settings
  ADD COLUMN IF NOT EXISTS payroll_working_days_per_month numeric(8,2) NOT NULL DEFAULT 22
  CHECK (payroll_working_days_per_month > 0);

ALTER TABLE public.payroll_run_lines
  ADD COLUMN IF NOT EXISTS days_absent numeric(10,2) NOT NULL DEFAULT 0
  CHECK (days_absent >= 0);

ALTER TABLE public.payroll_run_lines
  ADD COLUMN IF NOT EXISTS absent_deduction numeric(18,2) NOT NULL DEFAULT 0
  CHECK (absent_deduction >= 0);

COMMENT ON COLUMN public.payroll_org_settings.payroll_working_days_per_month IS 'Days in a typical pay month for daily rate = full gross / days (absence deduction).';
COMMENT ON COLUMN public.payroll_run_lines.days_absent IS 'Days absent this period; deduction = (full gross / working days) × days absent.';
COMMENT ON COLUMN public.payroll_run_lines.absent_deduction IS 'Amount deducted from full monthly gross before PAYE/NSSF.';
