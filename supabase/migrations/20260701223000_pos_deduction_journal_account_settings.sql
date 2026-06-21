-- Let every organization map POS commission and transport to its own chart codes.
ALTER TABLE public.journal_gl_settings
  ADD COLUMN IF NOT EXISTS pos_agent_commission_expense_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pos_transport_expense_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL;

-- Preserve the accounts already in use, while allowing administrators to replace them.
UPDATE public.journal_gl_settings settings
SET pos_agent_commission_expense_gl_account_id = account.id
FROM public.gl_accounts account
WHERE settings.organization_id = account.organization_id
  AND settings.pos_agent_commission_expense_gl_account_id IS NULL
  AND account.account_type = 'expense'
  AND (account.account_code = '53050' OR account.account_name ~* '(agent|sales).*commission|commission.*expense');

UPDATE public.journal_gl_settings settings
SET pos_transport_expense_gl_account_id = account.id
FROM public.gl_accounts account
WHERE settings.organization_id = account.organization_id
  AND settings.pos_transport_expense_gl_account_id IS NULL
  AND account.account_type = 'expense'
  AND (account.account_code = '53060' OR account.account_name ~* '(transport|delivery|freight|carriage).*expense');

-- New agents no longer create chart accounts with hard-coded codes.
DROP TRIGGER IF EXISTS trg_ensure_pos_agent_commission_expense_gl ON public.pos_sales_agents;

COMMENT ON COLUMN public.journal_gl_settings.pos_agent_commission_expense_gl_account_id IS
  'Organization-selected expense GL for manufacturing POS agent / bodaboda commissions.';
COMMENT ON COLUMN public.journal_gl_settings.pos_transport_expense_gl_account_id IS
  'Organization-selected expense GL for manufacturing POS rider transport costs.';
