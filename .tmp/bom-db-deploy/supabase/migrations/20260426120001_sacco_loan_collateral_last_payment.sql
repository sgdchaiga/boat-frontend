-- Adds collateral / LC1 / last_payment columns when sacco_loans already exists from an older
-- 20260426120000_sacco_core_data.sql (before those columns were added).
-- If public.sacco_loans does not exist yet, this migration does nothing — run
-- 20260426120000_sacco_core_data.sql first (after 20260425110000_sacco_members.sql).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'sacco_loans'
  ) THEN
    ALTER TABLE public.sacco_loans
      ADD COLUMN IF NOT EXISTS collateral_description text,
      ADD COLUMN IF NOT EXISTS lc1_chairman_name text,
      ADD COLUMN IF NOT EXISTS lc1_chairman_phone text,
      ADD COLUMN IF NOT EXISTS last_payment_date date;

    COMMENT ON COLUMN public.sacco_loans.collateral_description IS 'Description of collateral offered for the loan.';
    COMMENT ON COLUMN public.sacco_loans.lc1_chairman_name IS 'Local Council I chairperson name (collateral / locality verification).';
    COMMENT ON COLUMN public.sacco_loans.lc1_chairman_phone IS 'LC1 chairperson telephone.';
    COMMENT ON COLUMN public.sacco_loans.last_payment_date IS 'Most recent repayment date; set when payments are recorded.';
  ELSE
    RAISE NOTICE 'Skipped: public.sacco_loans does not exist. Apply 20260426120000_sacco_core_data.sql first.';
  END IF;
END $$;
