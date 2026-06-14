-- Group individual match records into user-visible reconciliation runs.

ALTER TABLE public.bank_reconciliation_matches
  ADD COLUMN IF NOT EXISTS reconciliation_run_id uuid;

-- All matches that exist when this migration is applied belong to the
-- organization's current reconciliation run for that GL account.
WITH account_runs AS (
  SELECT organization_id, bank_gl_account_id, gen_random_uuid() AS run_id
  FROM public.bank_reconciliation_matches
  GROUP BY organization_id, bank_gl_account_id
)
UPDATE public.bank_reconciliation_matches AS matches
SET reconciliation_run_id = account_runs.run_id
FROM account_runs
WHERE matches.organization_id = account_runs.organization_id
  AND matches.bank_gl_account_id = account_runs.bank_gl_account_id
  AND matches.reconciliation_run_id IS NULL;

ALTER TABLE public.bank_reconciliation_matches
  ALTER COLUMN reconciliation_run_id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN reconciliation_run_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bank_reconciliation_matches_run
  ON public.bank_reconciliation_matches (reconciliation_run_id);

COMMENT ON COLUMN public.bank_reconciliation_matches.reconciliation_run_id IS
  'Groups match records into one user-visible reconciliation history entry.';
