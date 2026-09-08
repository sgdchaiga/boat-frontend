-- GRN/Bills: debit should be inventory / shop stock (asset), not generic expense (e.g. payroll).

ALTER TABLE public.journal_gl_settings
  ADD COLUMN IF NOT EXISTS purchases_inventory_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.journal_gl_settings.purchases_inventory_gl_account_id IS
  'Default debit for GRN/Bills (inventory / shop stock). Falls back to POS inventory accounts or chart heuristics if unset.';
