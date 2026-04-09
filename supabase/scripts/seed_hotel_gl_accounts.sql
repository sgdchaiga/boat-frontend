-- =============================================================================
-- Hotel chart of accounts → public.gl_accounts (BOAT)
-- 1. Replace REPLACE_WITH_ORGANIZATION_UUID with your organizations.id.
-- 2. Run in Supabase SQL Editor.
--
-- Maps: Revenue → account_type 'income'; categories → allowed CHECK values.
-- Root 6000 is inserted before 5000 (parent 6000) via recursive ordering.
-- =============================================================================

DO $$
DECLARE
  boat_org uuid := 'REPLACE_WITH_ORGANIZATION_UUID'::uuid;
  r RECORD;
  pid uuid;
  new_id uuid;
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
    parent_code text,
    account_type_raw text NOT NULL,
    category_boat text
  ) ON COMMIT DROP;

  INSERT INTO stg (account_code, account_name, parent_code, account_type_raw, category_boat) VALUES
    ('1000', 'Assets', NULL, 'Asset', NULL),
    ('1100', 'Current Assets', '1000', 'Asset', NULL),
    ('1110', 'Cash on Hand', '1100', 'Asset', 'cash'),
    ('1120', 'Bank Account', '1100', 'Asset', 'cash'),
    ('1130', 'Mobile Money Account', '1100', 'Asset', 'cash'),
    ('1140', 'Accounts Receivable', '1100', 'Asset', 'receivable'),
    ('1150', 'Inventory – Bar', '1100', 'Asset', 'inventory'),
    ('1160', 'Inventory – Kitchen', '1100', 'Asset', 'inventory'),
    ('1170', 'Inventory – Housekeeping', '1100', 'Asset', 'inventory'),
    ('1180', 'Prepaid Expenses', '1100', 'Asset', 'other'),
    ('1200', 'Non-Current Assets', '1000', 'Asset', NULL),
    ('1210', 'Buildings', '1200', 'Asset', 'other'),
    ('1220', 'Furniture & Fixtures', '1200', 'Asset', 'other'),
    ('1230', 'Kitchen Equipment', '1200', 'Asset', 'other'),
    ('1240', 'Bar Equipment', '1200', 'Asset', 'other'),
    ('1250', 'Vehicles', '1200', 'Asset', 'other'),
    ('1260', 'Accumulated Depreciation', '1200', 'Asset', 'other'),
    ('2000', 'Liabilities', NULL, 'Liability', NULL),
    ('2100', 'Current Liabilities', '2000', 'Liability', NULL),
    ('2110', 'Accounts Payable', '2100', 'Liability', 'payable'),
    ('2120', 'Customer Deposits', '2100', 'Liability', 'other'),
    ('2130', 'Taxes Payable (VAT, PAYE)', '2100', 'Liability', 'payable'),
    ('2140', 'Accrued Expenses', '2100', 'Liability', 'payable'),
    ('2200', 'Long-Term Liabilities', '2000', 'Liability', NULL),
    ('2210', 'Bank Loan', '2200', 'Liability', 'other'),
    ('3000', 'Equity', NULL, 'Equity', NULL),
    ('3100', 'Owner Capital', '3000', 'Equity', 'other'),
    ('3200', 'Retained Earnings', '3000', 'Equity', 'other'),
    ('3300', 'Drawings', '3000', 'Equity', 'other'),
    ('4000', 'Revenue', NULL, 'Revenue', NULL),
    ('4100', 'Room Revenue', '4000', 'Revenue', 'revenue'),
    ('4110', 'Bar Revenue', '4000', 'Revenue', 'revenue'),
    ('4120', 'Restaurant Revenue', '4000', 'Revenue', 'revenue'),
    ('4130', 'Conference & Events Income', '4000', 'Revenue', 'revenue'),
    ('4140', 'Laundry Income', '4000', 'Revenue', 'revenue'),
    ('4200', 'Other Income', '4000', 'Revenue', 'revenue'),
    ('6000', 'Operating Expenses', NULL, 'Expense', NULL),
    ('5000', 'Cost of Sales', '6000', 'Expense', 'cogs'),
    ('5100', 'Bar Cost of Sales', '5000', 'Expense', 'cogs'),
    ('5200', 'Kitchen Cost of Sales', '5000', 'Expense', 'cogs'),
    ('6100', 'Salaries & Wages', '6000', 'Expense', 'expense'),
    ('6110', 'Staff Welfare', '6000', 'Expense', 'expense'),
    ('6200', 'Rent Expense', '6000', 'Expense', 'expense'),
    ('6300', 'Utilities (Water, Electricity)', '6000', 'Expense', 'expense'),
    ('6400', 'Internet & IT Expenses', '6000', 'Expense', 'expense'),
    ('6500', 'Cleaning & Housekeeping', '6000', 'Expense', 'expense'),
    ('6600', 'Repairs & Maintenance', '6000', 'Expense', 'expense'),
    ('6700', 'Security Expenses', '6000', 'Expense', 'expense'),
    ('6800', 'Marketing & Advertising', '6000', 'Expense', 'expense'),
    ('6900', 'Laundry Expenses', '6000', 'Expense', 'expense'),
    ('7000', 'Depreciation Expense', '6000', 'Expense', 'expense'),
    ('7100', 'Bank Charges', '6000', 'Expense', 'expense'),
    ('7200', 'Loan Interest', '6000', 'Expense', 'expense'),
    ('8000', 'Losses & Adjustments', '6000', 'Expense', 'expense'),
    ('8100', 'Inventory Loss/Shrinkage', '6000', 'Expense', 'expense');

  FOR r IN
    WITH RECURSIVE ordered AS (
      SELECT s.*, 0 AS depth
      FROM stg s
      WHERE s.parent_code IS NULL
      UNION ALL
      SELECT s.*, o.depth + 1
      FROM stg s
      JOIN ordered o ON s.parent_code = o.account_code
    )
    SELECT * FROM ordered
    ORDER BY depth, account_code
  LOOP
    v_type := CASE lower(trim(r.account_type_raw))
      WHEN 'asset' THEN 'asset'
      WHEN 'liability' THEN 'liability'
      WHEN 'equity' THEN 'equity'
      WHEN 'revenue' THEN 'income'
      WHEN 'expense' THEN 'expense'
      ELSE 'expense'
    END;

    v_cat := NULLIF(trim(r.category_boat), '');

    IF EXISTS (
      SELECT 1 FROM public.gl_accounts ga
      WHERE ga.organization_id = boat_org AND ga.account_code = trim(r.account_code)
    ) THEN
      SELECT ga.id INTO new_id
      FROM public.gl_accounts ga
      WHERE ga.organization_id = boat_org AND ga.account_code = trim(r.account_code)
      LIMIT 1;
      m := m || jsonb_build_object(trim(r.account_code), new_id::text);
      CONTINUE;
    END IF;

    pid := NULL;
    IF r.parent_code IS NOT NULL AND trim(r.parent_code) <> '' THEN
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

  RAISE NOTICE 'Hotel chart imported for org %', boat_org;
END $$;
