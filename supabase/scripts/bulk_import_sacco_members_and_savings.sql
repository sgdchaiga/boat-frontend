-- =============================================================================
-- SACCO bulk import: member profile + savings balances
-- =============================================================================
-- Supabase SQL Editor: run ONE step at a time (each block below is separate).
-- Do not paste BEGIN + both UPDATEs + ROLLBACK in one run unless you know your
-- client supports it. A missing ";" after INSERT causes:
--   ERROR: syntax error at or near "UPDATE"
--
-- Replace: 4b550bfd-14a1-4cb3-a873-77d210a55f00  (your organization_id)
-- =============================================================================

-- =============================================================================
-- STEP 1 — create staging tables (run alone)
-- =============================================================================
DROP TABLE IF EXISTS staging_sacco_member_updates;
DROP TABLE IF EXISTS staging_sacco_savings_balance_updates;

CREATE TEMP TABLE staging_sacco_member_updates (
  sacco_member_id uuid NOT NULL PRIMARY KEY,
  member_number text,
  full_name text,
  email text,
  phone text,
  national_id text,
  notes text,
  is_active boolean,
  gender text,
  date_of_birth date,
  marital_status text,
  address text,
  occupation text,
  next_of_kin text,
  nok_phone text,
  join_date date,
  savings_balance numeric,
  shares_balance numeric
);

CREATE TEMP TABLE staging_sacco_savings_balance_updates (
  sacco_member_id uuid NOT NULL,
  account_number text,
  savings_product_code text,
  sub_account text,
  new_balance numeric NOT NULL
);

-- =============================================================================
-- STEP 2a — member profile rows (run alone; MUST end last line with semicolon)
-- =============================================================================
-- INSERT INTO staging_sacco_member_updates (sacco_member_id, full_name, phone) VALUES
--   ('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'::uuid, 'Jane Member', '+256700000000');

-- =============================================================================
-- STEP 2b — savings balance rows (run alone; MUST end last line with semicolon)
-- =============================================================================
-- Match by account_number OR by savings_product_code when account_number is NULL.
--
-- INSERT INTO staging_sacco_savings_balance_updates
--   (sacco_member_id, account_number, savings_product_code, sub_account, new_balance)
-- VALUES
--   ('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'::uuid, '1010010015', NULL, NULL, 50000),
--   ('yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy'::uuid, NULL, '1', NULL, 120000);

-- =============================================================================
-- STEP 3 — preview bad rows (run alone; should return 0 rows)
-- =============================================================================
-- SELECT 'member not in org' AS issue, s.sacco_member_id::text AS key
-- FROM staging_sacco_member_updates s
-- LEFT JOIN public.sacco_members m
--   ON m.id = s.sacco_member_id
--  AND m.organization_id = '4b550bfd-14a1-4cb3-a873-77d210a55f00'::uuid
-- WHERE m.id IS NULL;

-- SELECT 'savings: member not in org' AS issue, s.sacco_member_id::text
-- FROM staging_sacco_savings_balance_updates s
-- LEFT JOIN public.sacco_members m
--   ON m.id = s.sacco_member_id
--  AND m.organization_id = '4b550bfd-14a1-4cb3-a873-77d210a55f00'::uuid
-- WHERE m.id IS NULL;

-- SELECT 'savings: no account row' AS issue, s.sacco_member_id::text
-- FROM staging_sacco_savings_balance_updates s
-- JOIN public.sacco_members m
--   ON m.id = s.sacco_member_id
--  AND m.organization_id = '4b550bfd-14a1-4cb3-a873-77d210a55f00'::uuid
-- LEFT JOIN public.sacco_member_savings_accounts a
--   ON a.organization_id = m.organization_id
-- AND a.sacco_member_id = s.sacco_member_id
-- AND (
--       (NULLIF(trim(s.account_number), '') IS NOT NULL AND a.account_number = trim(s.account_number))
--    OR (
--       NULLIF(trim(s.account_number), '') IS NULL
--       AND NULLIF(trim(s.savings_product_code), '') IS NOT NULL
--       AND a.savings_product_code = trim(s.savings_product_code)
--       AND COALESCE(a.sub_account, '') = COALESCE(NULLIF(trim(s.sub_account), ''), '')
--      )
--     )
-- WHERE a.id IS NULL;

-- =============================================================================
-- STEP 4 — update member register (run this query ALONE)
-- =============================================================================
UPDATE public.sacco_members m
SET
  member_number = COALESCE(s.member_number, m.member_number),
  full_name = COALESCE(s.full_name, m.full_name),
  email = COALESCE(s.email, m.email),
  phone = COALESCE(s.phone, m.phone),
  national_id = COALESCE(s.national_id, m.national_id),
  notes = COALESCE(s.notes, m.notes),
  is_active = COALESCE(s.is_active, m.is_active),
  gender = COALESCE(s.gender, m.gender),
  date_of_birth = COALESCE(s.date_of_birth, m.date_of_birth),
  marital_status = COALESCE(s.marital_status, m.marital_status),
  address = COALESCE(s.address, m.address),
  occupation = COALESCE(s.occupation, m.occupation),
  next_of_kin = COALESCE(s.next_of_kin, m.next_of_kin),
  nok_phone = COALESCE(s.nok_phone, m.nok_phone),
  join_date = COALESCE(s.join_date, m.join_date),
  savings_balance = COALESCE(s.savings_balance, m.savings_balance),
  shares_balance = COALESCE(s.shares_balance, m.shares_balance)
FROM staging_sacco_member_updates s
WHERE m.id = s.sacco_member_id
  AND m.organization_id = '4b550bfd-14a1-4cb3-a873-77d210a55f00'::uuid;

-- =============================================================================
-- STEP 5 — update savings account balances (run this query ALONE, after STEP 4)
-- =============================================================================
UPDATE public.sacco_member_savings_accounts a
SET
  balance = s.new_balance,
  updated_at = now()
FROM staging_sacco_savings_balance_updates s
INNER JOIN public.sacco_members m
  ON m.id = s.sacco_member_id
 AND m.organization_id = '4b550bfd-14a1-4cb3-a873-77d210a55f00'::uuid
WHERE a.organization_id = m.organization_id
  AND a.sacco_member_id = m.id
  AND (
        (NULLIF(trim(s.account_number), '') IS NOT NULL AND a.account_number = trim(s.account_number))
     OR (
        NULLIF(trim(s.account_number), '') IS NULL
        AND NULLIF(trim(s.savings_product_code), '') IS NOT NULL
        AND a.savings_product_code = trim(s.savings_product_code)
        AND COALESCE(a.sub_account, '') = COALESCE(NULLIF(trim(s.sub_account), ''), '')
       )
      );
