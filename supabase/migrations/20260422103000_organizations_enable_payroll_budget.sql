-- Superuser-controlled module flags for payroll and budget.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS enable_payroll boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enable_budget boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.organizations.enable_payroll IS
  'Platform toggle: enables Payroll module for the organization.';

COMMENT ON COLUMN public.organizations.enable_budget IS
  'Platform toggle: enables Budget module (budgeting + budget variance report) for the organization.';
