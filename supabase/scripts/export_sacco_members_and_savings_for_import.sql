-- Export members + savings accounts for bulk balance import.
-- Replace organization_id, run in SQL Editor, use results to build INSERT rows.

-- A) Members (for profile import / to get real UUIDs)
SELECT
  m.id AS sacco_member_id,
  m.member_number,
  m.full_name,
  m.phone,
  m.savings_balance AS member_register_savings,
  m.shares_balance AS member_register_shares
FROM public.sacco_members m
WHERE m.organization_id = '4b550bfd-14a1-4cb3-a873-77d210a55f00'::uuid
  AND m.is_active = true
ORDER BY
  CASE WHEN m.member_number ~ '^\d+$' THEN m.member_number::bigint ELSE 999999999 END,
  m.member_number;

-- B) Existing savings accounts (use these columns in staging INSERT)
SELECT
  a.sacco_member_id,
  a.account_number,
  a.savings_product_code,
  a.sub_account,
  a.balance AS current_balance,
  m.member_number,
  m.full_name
FROM public.sacco_member_savings_accounts a
JOIN public.sacco_members m
  ON m.id = a.sacco_member_id
 AND m.organization_id = a.organization_id
WHERE a.organization_id = '4b550bfd-14a1-4cb3-a873-77d210a55f00'::uuid
  AND COALESCE(a.is_active, true)
ORDER BY m.member_number, a.account_number;

-- C) Members with NO savings account yet (need backfill before balance import)
SELECT
  m.id AS sacco_member_id,
  m.member_number,
  m.full_name
FROM public.sacco_members m
WHERE m.organization_id = '4b550bfd-14a1-4cb3-a873-77d210a55f00'::uuid
  AND m.is_active = true
  AND NOT EXISTS (
    SELECT 1
    FROM public.sacco_member_savings_accounts a
    WHERE a.sacco_member_id = m.id
      AND a.organization_id = m.organization_id
  )
ORDER BY m.member_number;
