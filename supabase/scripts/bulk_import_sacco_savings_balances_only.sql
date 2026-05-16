-- =============================================================================
-- SACCO: bulk update savings account balances ONLY (run in Supabase SQL Editor)
-- =============================================================================
-- 1) Replace ORG_ID below (all 3 places).
-- 2) Run "STEP 1" as one query.
-- 3) Paste your rows into STEP 2 INSERT (end with semicolon).
-- 4) Run STEP 2, then STEP 3 preview, then STEP 4 apply.
-- =============================================================================

-- ORG_ID: 4b550bfd-14a1-4cb3-a873-77d210a55f00

-- ========== STEP 1 — staging table (run this alone) ==========
DROP TABLE IF EXISTS staging_sacco_savings_balance_updates;
CREATE TEMP TABLE staging_sacco_savings_balance_updates (
  sacco_member_id uuid NOT NULL,
  account_number text,
  savings_product_code text,
  sub_account text,
  new_balance numeric NOT NULL
);

-- ========== STEP 2 — paste data (run this alone; must end with ;) ==========
INSERT INTO staging_sacco_savings_balance_updates
  (sacco_member_id, account_number, savings_product_code, sub_account, new_balance)
VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid, NULL, '1', NULL, 0);
  -- add more rows: ('member-uuid'::uuid, NULL, '1', NULL, 12345.67),

-- ========== STEP 3 — preview unmatched (run alone; expect 0 rows) ==========
SELECT s.*
FROM staging_sacco_savings_balance_updates s
LEFT JOIN public.sacco_members m
  ON m.id = s.sacco_member_id
 AND m.organization_id = '4b550bfd-14a1-4cb3-a873-77d210a55f00'::uuid
WHERE m.id IS NULL
UNION ALL
SELECT s.*
FROM staging_sacco_savings_balance_updates s
JOIN public.sacco_members m
  ON m.id = s.sacco_member_id
 AND m.organization_id = '4b550bfd-14a1-4cb3-a873-77d210a55f00'::uuid
LEFT JOIN public.sacco_member_savings_accounts a
  ON a.organization_id = m.organization_id
 AND a.sacco_member_id = s.sacco_member_id
 AND (
       (NULLIF(trim(s.account_number), '') IS NOT NULL AND a.account_number = trim(s.account_number))
    OR (
       NULLIF(trim(s.account_number), '') IS NULL
       AND NULLIF(trim(s.savings_product_code), '') IS NOT NULL
       AND a.savings_product_code = trim(s.savings_product_code)
       AND COALESCE(a.sub_account, '') = COALESCE(NULLIF(trim(s.sub_account), ''), '')
      )
     )
WHERE a.id IS NULL;

-- ========== STEP 4 — apply balances (run this alone) ==========
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
