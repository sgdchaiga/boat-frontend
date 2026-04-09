-- =============================================================================
-- Import SACCO-style chart of accounts into BOAT (public.gl_accounts)
--
-- 1. Replace :boat_org below with your Supabase organization UUID (sacco tenant).
-- 2. Add any missing rows from your spreadsheet into `stg` VALUES (same 5 columns).
-- 3. Run in Supabase SQL Editor (or psql).
--
-- Maps spreadsheet `account_type` like "10000 - Asset" → BOAT account_type.
-- Roots: rows where parent_code = account_code get parent_id NULL.
-- =============================================================================

DO $$
DECLARE
  boat_org uuid := 'REPLACE_WITH_ORGANIZATION_UUID'::uuid;
  r RECORD;
  pid uuid;
  new_id uuid;
  merge_id uuid;
  m jsonb := '{}'::jsonb;
  v_type text;
  v_cat text;
BEGIN
  IF boat_org IS NULL OR boat_org = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Set boat_org to your organizations.id UUID';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = boat_org) THEN
    RAISE EXCEPTION 'Organization % not found', boat_org;
  END IF;

  CREATE TEMP TABLE stg (
    account_code text NOT NULL,
    account_name text NOT NULL,
    parent_code text NOT NULL,
    account_level int NOT NULL,
    account_type_raw text NOT NULL
  ) ON COMMIT DROP;

  -- Paste additional rows from your spreadsheet here (same column order).
  INSERT INTO stg (account_code, account_name, parent_code, account_level, account_type_raw)
  VALUES
    -- Assets (10000 - Asset)
    ('11000', 'Cash and Bank', '11000', 1, '10000 - Asset'),
    ('11010', 'Cash General', '11000', 2, '10000 - Asset'),
    ('11020', 'Petty Cash', '11000', 2, '10000 - Asset'),
    ('11030', 'Bank Current Account', '11000', 2, '10000 - Asset'),
    ('12000', 'Accounts Receivable', '12000', 1, '10000 - Asset'),
    ('12100', 'Loan Receivables - Principal', '12000', 2, '10000 - Asset'),
    ('12200', 'Loan Receivables - Interest Due', '12000', 2, '10000 - Asset'),
    ('13000', 'Inventory', '13000', 1, '10000 - Asset'),
    ('14000', 'Prepayments', '14000', 1, '10000 - Asset'),
    ('15000', 'Fixed Assets', '15000', 1, '10000 - Asset'),
    ('15100', 'Furniture & Fixtures', '15000', 2, '10000 - Asset'),
    ('15200', 'Computer Equipment', '15000', 2, '10000 - Asset'),
    ('19000', 'Other Assets', '19000', 1, '10000 - Asset'),
    -- Liabilities (20000 - Liability)
    ('20000', 'Savings and deposits', '20000', 1, '20000 - Liability'),
    ('20101', 'Savings Account', '20000', 2, '20000 - Liability'),
    ('20200', 'Member Deposits - Fixed', '20000', 2, '20000 - Liability'),
    ('21000', 'Accounts Payable', '21000', 1, '20000 - Liability'),
    ('21100', 'Trade Payables', '21000', 2, '20000 - Liability'),
    ('22000', 'Payables', '22000', 1, '20000 - Liability'),
    ('23000', 'Tax Payable', '23000', 1, '20000 - Liability'),
    ('24000', 'Accrued Expenses', '24000', 1, '20000 - Liability'),
    ('25000', 'Short-term Borrowings', '25000', 1, '20000 - Liability'),
    ('26000', 'Deferred income', '26000', 1, '20000 - Liability'),
    -- Equity (30000 - Equity)
    ('30000', 'Equity', '30000', 1, '30000 - Equity'),
    ('30100', 'Member Shares', '30000', 2, '30000 - Equity'),
    ('30200', 'Statutory Reserve', '30000', 2, '30000 - Equity'),
    ('30300', 'Retained Earnings', '30000', 2, '30000 - Equity'),
    -- Revenue (40000 - Revenue) → BOAT account_type "income"
    ('41000', 'Interest Income', '41000', 1, '40000 - Revenue'),
    ('41101', 'Interest on Loan', '41000', 2, '40000 - Revenue'),
    ('41200', 'Fees and Charges', '41000', 2, '40000 - Revenue'),
    ('41300', 'Commission Income', '41000', 2, '40000 - Revenue'),
    ('42000', 'Other Income', '42000', 1, '40000 - Revenue'),
    -- Expenses (50000 - Expense)
    ('50000', 'Expenses', '50000', 1, '50000 - Expense'),
    ('51000', 'Purchases', '50000', 2, '50000 - Expense'),
    ('51010', 'Interest Paid', '52000', 2, '50000 - Expense'),
    ('52000', 'Interest paid', '52000', 1, '50000 - Expense'),
    ('53000', 'Commission expense', '53000', 1, '50000 - Expense'),
    ('54000', 'Staff Costs', '54000', 1, '50000 - Expense'),
    ('54010', 'Staff Salaries', '54000', 2, '50000 - Expense'),
    ('55000', 'Utilities', '55000', 1, '50000 - Expense'),
    ('55013', 'Electricity', '55000', 2, '50000 - Expense'),
    ('56000', 'Purchase (non-trade)', '50000', 2, '50000 - Expense');

  -- Add any remaining rows from your spreadsheet into VALUES above (unique account_code per org).

  FOR r IN
    SELECT * FROM stg
    ORDER BY account_level, account_code
  LOOP
    v_type := CASE
      WHEN r.account_type_raw ILIKE '%asset%' THEN 'asset'
      WHEN r.account_type_raw ILIKE '%liability%' THEN 'liability'
      WHEN r.account_type_raw ILIKE '%equity%' THEN 'equity'
      WHEN r.account_type_raw ILIKE '%revenue%' THEN 'income'
      WHEN r.account_type_raw ILIKE '%expense%' THEN 'expense'
      ELSE 'expense'
    END;

    v_cat := CASE
      WHEN r.account_name ~* 'cash|bank|petty' THEN 'cash'
      WHEN r.account_name ~* 'receivable' THEN 'receivable'
      WHEN r.account_name ~* 'payable' THEN 'payable'
      WHEN r.account_name ~* 'inventory' THEN 'inventory'
      WHEN r.account_name ~* 'cogs|cost of goods' THEN 'cogs'
      WHEN v_type = 'income' THEN 'revenue'
      WHEN v_type = 'expense' THEN 'expense'
      ELSE 'other'
    END;

    IF EXISTS (
      SELECT 1 FROM public.gl_accounts ga
      WHERE ga.organization_id = boat_org AND ga.account_code = trim(r.account_code)
    ) THEN
      SELECT ga.id INTO merge_id
      FROM public.gl_accounts ga
      WHERE ga.organization_id = boat_org AND ga.account_code = trim(r.account_code)
      LIMIT 1;
      m := m || jsonb_build_object(trim(r.account_code), merge_id::text);
      CONTINUE;
    END IF;

    pid := NULL;
    IF trim(r.parent_code) = trim(r.account_code) THEN
      pid := NULL;
    ELSE
      IF m ? trim(r.parent_code) THEN
        pid := (m ->> trim(r.parent_code))::uuid;
      ELSE
        SELECT ga.id INTO pid
        FROM public.gl_accounts ga
        WHERE ga.organization_id = boat_org AND ga.account_code = trim(r.parent_code)
        LIMIT 1;
      END IF;
      IF pid IS NULL THEN
        RAISE EXCEPTION 'Parent code % not found for account % (%)', r.parent_code, r.account_code, r.account_name;
      END IF;
    END IF;

    new_id := gen_random_uuid();
    INSERT INTO public.gl_accounts (
      id,
      account_code,
      account_name,
      account_type,
      category,
      parent_id,
      organization_id,
      is_active
    ) VALUES (
      new_id,
      trim(r.account_code),
      trim(r.account_name),
      v_type,
      v_cat,
      pid,
      boat_org,
      true
    );
    m := m || jsonb_build_object(trim(r.account_code), new_id::text);
  END LOOP;

  RAISE NOTICE 'Imported / merged chart for org %', boat_org;
END $$;

-- Optional: set default journal mapping for SACCO (adjust account_code to match your chart)
/*
INSERT INTO public.journal_gl_settings (
  organization_id,
  revenue_gl_account_id,
  cash_gl_account_id,
  receivable_gl_account_id,
  expense_gl_account_id,
  payable_gl_account_id
)
SELECT
  'REPLACE_WITH_ORGANIZATION_UUID'::uuid,
  (SELECT id FROM public.gl_accounts WHERE organization_id = 'REPLACE_WITH_ORGANIZATION_UUID'::uuid AND account_code = '41101' LIMIT 1),
  (SELECT id FROM public.gl_accounts WHERE organization_id = 'REPLACE_WITH_ORGANIZATION_UUID'::uuid AND account_code = '11010' LIMIT 1),
  (SELECT id FROM public.gl_accounts WHERE organization_id = 'REPLACE_WITH_ORGANIZATION_UUID'::uuid AND account_code = '12100' LIMIT 1),
  (SELECT id FROM public.gl_accounts WHERE organization_id = 'REPLACE_WITH_ORGANIZATION_UUID'::uuid AND account_code = '54010' LIMIT 1),
  (SELECT id FROM public.gl_accounts WHERE organization_id = 'REPLACE_WITH_ORGANIZATION_UUID'::uuid AND account_code = '21100' LIMIT 1)
ON CONFLICT (organization_id) DO UPDATE SET
  revenue_gl_account_id = COALESCE(journal_gl_settings.revenue_gl_account_id, EXCLUDED.revenue_gl_account_id),
  cash_gl_account_id = COALESCE(journal_gl_settings.cash_gl_account_id, EXCLUDED.cash_gl_account_id),
  receivable_gl_account_id = COALESCE(journal_gl_settings.receivable_gl_account_id, EXCLUDED.receivable_gl_account_id),
  expense_gl_account_id = COALESCE(journal_gl_settings.expense_gl_account_id, EXCLUDED.expense_gl_account_id),
  payable_gl_account_id = COALESCE(journal_gl_settings.payable_gl_account_id, EXCLUDED.payable_gl_account_id),
  updated_at = now();
*/
