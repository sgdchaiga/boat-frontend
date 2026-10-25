-- 8040 is an opening-balance clearing asset, never an administration expense.
-- Reclassification corrects existing opening journals without changing their
-- amounts or creating a duplicate journal.
UPDATE public.gl_accounts
SET account_type = 'asset',
    category = 'other'
WHERE account_code = '8040'
  AND lower(account_name) LIKE '%opening%balance%clear%'
  AND account_type <> 'asset';

COMMENT ON TABLE public.sacco_savings_opening_balance_postings IS
  'Opening member-savings journals debit GL 8040 Opening Balance Clearing (asset) and credit mapped savings liabilities.';
