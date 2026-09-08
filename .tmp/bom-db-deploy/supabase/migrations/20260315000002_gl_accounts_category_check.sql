-- Allow GL account category values used by the app (dropdown: revenue, cash, receivable, expense, payable, inventory, cogs, other)
-- Fixes: new row violates check constraint "gl_accounts_category_check"

ALTER TABLE gl_accounts DROP CONSTRAINT IF EXISTS gl_accounts_category_check;

ALTER TABLE gl_accounts ADD CONSTRAINT gl_accounts_category_check
  CHECK (category IS NULL OR category IN (
    'revenue', 'cash', 'receivable', 'expense', 'payable',
    'inventory', 'cogs', 'other'
  ));
