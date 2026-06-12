-- Treasury Spend Money approval is optional. Rejected expenses retain an auditable cancellation state.

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_status_check;
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_status_check CHECK (status IN ('active', 'cancelled'));

COMMENT ON COLUMN public.expenses.status IS
  'Active or cancelled. Treasury rejection cancels the source expense and posts an auditable reversal when needed.';

INSERT INTO public.organization_permissions (organization_id, role_key, permission_key, allowed)
SELECT id, '__org__', 'treasury_spend_money_approval_enabled', true
FROM public.organizations
ON CONFLICT (organization_id, role_key, permission_key) DO NOTHING;
