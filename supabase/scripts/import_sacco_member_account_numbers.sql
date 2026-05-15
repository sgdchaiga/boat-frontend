-- Import savings account numbers for existing SACCO members
-- Run in Supabase SQL Editor (service_role or as org admin with RLS bypass via SQL editor).
--
-- BEFORE RUNNING:
--   1. Set v_organization_id below to your organization UUID.
--   2. Fill the import_data rows: member_name must match sacco_members.full_name (trimmed, case-insensitive).
--      Or use member_number instead — see the alternate CTE at the bottom.
--   3. Set v_product_code to your default savings product code (e.g. '1' or '12').
--   4. Optional: set v_branch_code if branch_code column exists (migration 20260515120000).
--
-- The script skips members who already have a savings account for v_product_code.
-- Review the preview SELECT before running the INSERT block.

DO $$
DECLARE
  v_organization_id uuid := '00000000-0000-0000-0000-000000000000'; -- <<< REPLACE
  v_product_code text := '1';                                        -- <<< REPLACE
  v_branch_code text := '1';                                         -- <<< REPLACE (or NULL)
BEGIN
  IF v_organization_id = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Set v_organization_id to your organization UUID before running.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- STEP 1: Paste your list here (member_name, account_number)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE import_sacco_accounts (
  member_name text NOT NULL,
  account_number text NOT NULL
) ON COMMIT DROP;

INSERT INTO import_sacco_accounts (member_name, account_number) VALUES
  -- ('FULL NAME AS IN REGISTER', 'ACCOUNT_NUMBER'),
  ('Example Member One', '1011200001'),
  ('Example Member Two', '1011200002');
  -- Add one row per member from your list…

-- ---------------------------------------------------------------------------
-- STEP 2: Preview matches (run this block first; fix any "NOT FOUND" rows)
-- ---------------------------------------------------------------------------
WITH params AS (
  SELECT
    '00000000-0000-0000-0000-000000000000'::uuid AS organization_id, -- <<< REPLACE (same as above)
    '1'::text AS product_code
),
preview AS (
  SELECT
    i.member_name AS import_name,
    i.account_number,
    m.id AS sacco_member_id,
    m.member_number,
    m.full_name,
    EXISTS (
      SELECT 1
      FROM public.sacco_member_savings_accounts a
      CROSS JOIN params p
      WHERE a.organization_id = p.organization_id
        AND a.sacco_member_id = m.id
        AND a.savings_product_code = p.product_code
    ) AS already_has_account,
    EXISTS (
      SELECT 1
      FROM public.sacco_member_savings_accounts a
      CROSS JOIN params p
      WHERE a.organization_id = p.organization_id
        AND a.account_number = trim(i.account_number)
    ) AS account_number_taken
  FROM import_sacco_accounts i
  CROSS JOIN params p
  LEFT JOIN public.sacco_members m
    ON m.organization_id = p.organization_id
   AND lower(trim(m.full_name)) = lower(trim(i.member_name))
)
SELECT
  import_name,
  account_number,
  member_number,
  full_name,
  CASE
    WHEN sacco_member_id IS NULL THEN 'NOT FOUND — fix name or use member_number matching'
    WHEN already_has_account THEN 'SKIP — already has savings account for this product'
    WHEN account_number_taken THEN 'CONFLICT — account number already used'
    ELSE 'OK — will insert'
  END AS status
FROM preview
ORDER BY status, import_name;

-- ---------------------------------------------------------------------------
-- STEP 3: Insert savings accounts (uncomment after preview looks correct)
-- ---------------------------------------------------------------------------
/*
WITH params AS (
  SELECT
    '00000000-0000-0000-0000-000000000000'::uuid AS organization_id, -- <<< REPLACE
    '1'::text AS product_code,
    '1'::text AS branch_code
),
to_insert AS (
  SELECT
    p.organization_id,
    m.id AS sacco_member_id,
    p.product_code AS savings_product_code,
    trim(i.account_number) AS account_number,
    p.branch_code AS branch_code,
    m.member_number AS client_no,
    m.full_name AS client_full_name,
    m.phone AS telephone,
    m.email,
    current_date AS date_account_opened
  FROM import_sacco_accounts i
  CROSS JOIN params p
  INNER JOIN public.sacco_members m
    ON m.organization_id = p.organization_id
   AND lower(trim(m.full_name)) = lower(trim(i.member_name))
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.sacco_member_savings_accounts a
    WHERE a.organization_id = p.organization_id
      AND a.sacco_member_id = m.id
      AND a.savings_product_code = p.product_code
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.sacco_member_savings_accounts a
    WHERE a.organization_id = p.organization_id
      AND a.account_number = trim(i.account_number)
  )
)
INSERT INTO public.sacco_member_savings_accounts (
  organization_id,
  sacco_member_id,
  savings_product_code,
  account_number,
  branch_code,
  client_no,
  client_full_name,
  telephone,
  email,
  date_account_opened,
  balance,
  is_active
)
SELECT
  organization_id,
  sacco_member_id,
  savings_product_code,
  account_number,
  branch_code,
  client_no,
  client_full_name,
  telephone,
  email,
  date_account_opened,
  0,
  true
FROM to_insert;
*/

-- ---------------------------------------------------------------------------
-- ALTERNATE: match by member_number instead of full_name
-- Replace the JOIN in preview/insert with:
--   AND m.member_number = trim(i.member_number)
-- and use columns (member_number, account_number) in import_sacco_accounts.
-- ---------------------------------------------------------------------------
