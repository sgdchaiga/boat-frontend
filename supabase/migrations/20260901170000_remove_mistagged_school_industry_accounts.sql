-- Correct unrelated industry accounts that were previously mistagged as
-- school accounts. Keep posted rows active for ledger history; the frontend
-- still excludes them from the school Chart of Accounts.

WITH unrelated AS (
  SELECT ga.id
  FROM public.gl_accounts ga
  JOIN public.organizations organization ON organization.id = ga.organization_id
  WHERE lower(COALESCE(organization.business_type, '')) = 'school'
    AND ga.is_active = true
    AND concat_ws(' ', ga.account_name, ga.category) ~* (
      'raw materials?|manufacturing|work in progress|finished goods|factory |production |' ||
      'cost of goods manufactured|scrap inventory|guest room|room revenue|housekeeping|' ||
      'bar sales|bar inventory|kitchen sales|restaurant sales|patient|pharmacy|laboratory revenue|' ||
      'loan portfolio|loan principal|borrower|member savings|share[- ]?out|teller vault'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.journal_entry_lines jel WHERE jel.gl_account_id = ga.id
    )
)
UPDATE public.gl_accounts ga
SET is_active = false
FROM unrelated
WHERE ga.id = unrelated.id;
