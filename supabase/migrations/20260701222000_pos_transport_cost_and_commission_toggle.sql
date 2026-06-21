-- Per-sale rider transport deductions and an organization-level commission switch.
ALTER TABLE public.retail_sales
  ADD COLUMN IF NOT EXISTS transport_cost numeric(15,2) NOT NULL DEFAULT 0 CHECK (transport_cost >= 0);

INSERT INTO public.organization_permissions (organization_id, role_key, permission_key, allowed)
SELECT organization.id, '__org__', 'retail_pos_agent_commission_enabled', true
FROM public.organizations organization
WHERE organization.business_type = 'manufacturing'
ON CONFLICT (organization_id, role_key, permission_key) DO NOTHING;

INSERT INTO public.gl_accounts (
  organization_id, account_code, account_name, account_type, category, is_active
)
SELECT organization.id, '53060', 'Transport Expense', 'expense', 'expense', true
FROM public.organizations organization
WHERE organization.business_type = 'manufacturing'
  AND NOT EXISTS (
    SELECT 1 FROM public.gl_accounts account
    WHERE account.organization_id = organization.id
      AND account.account_type = 'expense'
      AND (account.account_code = '53060' OR account.account_name ~* '(transport|delivery|freight|carriage).*expense')
  )
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.ensure_pos_agent_commission_expense_gl()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.gl_accounts account
    WHERE account.organization_id = NEW.organization_id
      AND account.account_type = 'expense'
      AND (account.account_code = '53050' OR account.account_name ~* '(agent|sales).*commission|commission.*expense')
  ) THEN
    INSERT INTO public.gl_accounts (
      organization_id, account_code, account_name, account_type, category, is_active
    ) VALUES (
      NEW.organization_id, '53050', 'Agent Commission Expense', 'expense', 'expense', true
    ) ON CONFLICT DO NOTHING;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.gl_accounts account
    WHERE account.organization_id = NEW.organization_id
      AND account.account_type = 'expense'
      AND (account.account_code = '53060' OR account.account_name ~* '(transport|delivery|freight|carriage).*expense')
  ) THEN
    INSERT INTO public.gl_accounts (
      organization_id, account_code, account_name, account_type, category, is_active
    ) VALUES (
      NEW.organization_id, '53060', 'Transport Expense', 'expense', 'expense', true
    ) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON COLUMN public.retail_sales.transport_cost IS 'Manual rider transport deduction for this POS sale.';
COMMENT ON COLUMN public.retail_sales.net_amount_due IS 'Gross sale less agent commission and rider transport cost.';
