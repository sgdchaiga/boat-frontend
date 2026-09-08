-- Keep POS agent commissions separately reportable in the general ledger.
INSERT INTO public.gl_accounts (
  organization_id, account_code, account_name, account_type, category, is_active
)
SELECT organization.id, '53050', 'Agent Commission Expense', 'expense', 'expense', true
FROM public.organizations organization
WHERE organization.business_type = 'manufacturing'
  AND NOT EXISTS (
    SELECT 1 FROM public.gl_accounts account
    WHERE account.organization_id = organization.id
      AND account.account_type = 'expense'
      AND (account.account_code = '53050' OR account.account_name ~* '(agent|sales).*commission|commission.*expense')
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
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_pos_agent_commission_expense_gl ON public.pos_sales_agents;
CREATE TRIGGER trg_ensure_pos_agent_commission_expense_gl
AFTER INSERT ON public.pos_sales_agents
FOR EACH ROW EXECUTE FUNCTION public.ensure_pos_agent_commission_expense_gl();
