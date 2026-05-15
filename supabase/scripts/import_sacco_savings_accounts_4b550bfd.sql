-- Import first savings account per member for organization
-- 4b550bfd-14a1-4cb3-a873-77d210a55f00
--
-- Account numbers are built from sacco_account_number_settings:
--   branch segment + product (account type) segment + serial = member_number
-- Same rules as in-app backfill (member 15 → serial 15 in the account number).
--
-- RUN ORDER:
--   1) Preview (STEP 1)
--   2) Optional: clear existing rows (STEP 0) if starting fresh
--   3) Insert (STEP 2)

-- =============================================================================
-- STEP 0 (optional) — remove existing savings accounts for this org only
-- =============================================================================
/*
DELETE FROM public.sacco_member_savings_accounts
WHERE organization_id = '4b550bfd-14a1-4cb3-a873-77d210a55f00'::uuid;
*/

-- =============================================================================
-- STEP 1 — Preview: member_id, member_number, account_number to be created
-- =============================================================================
WITH org AS (
  SELECT '4b550bfd-14a1-4cb3-a873-77d210a55f00'::uuid AS organization_id
),
fmt AS (
  SELECT s.*
  FROM public.sacco_account_number_settings s
  CROSS JOIN org
  WHERE s.organization_id = org.organization_id
),
params AS (
  SELECT
    org.organization_id,
    COALESCE(
      (
        SELECT t.code
        FROM public.sacco_savings_product_types t
        WHERE t.organization_id = org.organization_id
          AND t.is_active
          AND trim(t.code) = trim(f.account_type_value)
        LIMIT 1
      ),
      (
        SELECT t.code
        FROM public.sacco_savings_product_types t
        WHERE t.organization_id = org.organization_id
          AND t.is_active
        ORDER BY t.sort_order, t.code
        LIMIT 1
      ),
      f.account_type_value,
      '1'
    ) AS product_code,
    COALESCE(
      (
        SELECT b.code
        FROM public.sacco_branches b
        WHERE b.organization_id = org.organization_id
          AND b.is_active
          AND b.is_default
        LIMIT 1
      ),
      (
        SELECT b.code
        FROM public.sacco_branches b
        WHERE b.organization_id = org.organization_id
          AND b.is_active
        ORDER BY b.sort_order, b.code
        LIMIT 1
      ),
      f.branch_value
    ) AS branch_code
  FROM org
  CROSS JOIN fmt f
),
settings AS (
  SELECT f.*, p.product_code, p.branch_code
  FROM fmt f
  CROSS JOIN params p
),
members AS (
  SELECT
    m.id AS sacco_member_id,
    m.member_number,
    m.full_name,
    m.email,
    m.phone,
    m.gender,
    m.date_of_birth,
    m.marital_status,
    m.address,
    m.occupation,
    m.next_of_kin,
    m.nok_phone,
    CASE
      WHEN m.member_number ~ '^\d+$' THEN m.member_number::bigint
      ELSE COALESCE(NULLIF(substring(m.member_number from '(\d+)$'), ''), '0')::bigint
    END AS serial_n
  FROM public.sacco_members m
  CROSS JOIN params p
  WHERE m.organization_id = p.organization_id
    AND m.is_active = true
),
built AS (
  SELECT
    mem.*,
    s.product_code,
    s.branch_code,
    lpad(
      LEAST(
        GREATEST(
          COALESCE(
            NULLIF(regexp_replace(s.branch_code, '\D', '', 'g'), ''),
            NULLIF(regexp_replace(s.branch_value, '\D', '', 'g'), ''),
            '0'
          )::bigint,
          0
        ),
        (10 ^ s.branch_digit_count) - 1
      )::text,
      s.branch_digit_count,
      '0'
    ) AS seg_branch,
    lpad(
      LEAST(
        GREATEST(COALESCE(NULLIF(regexp_replace(s.product_code, '\D', '', 'g'), ''), '0')::bigint, 0),
        (10 ^ s.account_type_digit_count) - 1
      )::text,
      s.account_type_digit_count,
      '0'
    ) AS seg_product,
    lpad(
      LEAST(GREATEST(mem.serial_n, 0), (10 ^ s.serial_digit_count) - 1)::text,
      s.serial_digit_count,
      '0'
    ) AS seg_serial,
    s.separator
  FROM members mem
  CROSS JOIN settings s
),
numbered AS (
  SELECT
    b.*,
    CASE
      WHEN b.separator IS NULL OR b.separator = '' THEN b.seg_branch || b.seg_product || b.seg_serial
      ELSE b.seg_branch || b.separator || b.seg_product || b.separator || b.seg_serial
    END AS account_number
  FROM built b
)
SELECT
  n.sacco_member_id AS member_id,
  n.member_number,
  n.full_name,
  n.product_code AS savings_product_code,
  n.branch_code,
  n.account_number,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM public.sacco_member_savings_accounts a
      WHERE a.organization_id = (SELECT organization_id FROM params)
        AND a.sacco_member_id = n.sacco_member_id
    ) THEN 'SKIP — member already has savings account'
    WHEN EXISTS (
      SELECT 1 FROM public.sacco_member_savings_accounts a
      WHERE a.organization_id = (SELECT organization_id FROM params)
        AND a.account_number = n.account_number
    ) THEN 'CONFLICT — account number taken'
    ELSE 'OK — will insert'
  END AS status
FROM numbered n
ORDER BY n.serial_n, n.member_number;

-- =============================================================================
-- STEP 2 — Insert (uncomment after preview looks correct)
-- =============================================================================
/*
WITH params AS (
  SELECT '4b550bfd-14a1-4cb3-a873-77d210a55f00'::uuid AS organization_id
),
settings AS (
  SELECT
    s.*,
    COALESCE(
      (SELECT t.code FROM public.sacco_savings_product_types t, params p
       WHERE t.organization_id = p.organization_id AND t.is_active
         AND trim(t.code) = trim(s.account_type_value) LIMIT 1),
      (SELECT t.code FROM public.sacco_savings_product_types t, params p
       WHERE t.organization_id = p.organization_id AND t.is_active
       ORDER BY t.sort_order, t.code LIMIT 1),
      s.account_type_value, '1'
    ) AS product_code,
    COALESCE(
      (SELECT b.code FROM public.sacco_branches b, params p
       WHERE b.organization_id = p.organization_id AND b.is_active AND b.is_default LIMIT 1),
      (SELECT b.code FROM public.sacco_branches b, params p
       WHERE b.organization_id = p.organization_id AND b.is_active
       ORDER BY b.sort_order, b.code LIMIT 1),
      s.branch_value
    ) AS branch_code
  FROM public.sacco_account_number_settings s
  CROSS JOIN params p
  WHERE s.organization_id = p.organization_id
),
members AS (
  SELECT
    m.id AS sacco_member_id,
    m.member_number,
    m.full_name,
    m.email,
    m.phone,
    m.gender,
    m.date_of_birth,
    m.marital_status,
    m.address,
    m.occupation,
    m.next_of_kin,
    m.nok_phone,
    CASE WHEN m.member_number ~ '^\d+$' THEN m.member_number::bigint
         ELSE COALESCE(NULLIF(substring(m.member_number from '(\d+)$'), ''), '0')::bigint END AS serial_n
  FROM public.sacco_members m
  CROSS JOIN params p
  WHERE m.organization_id = p.organization_id AND m.is_active = true
),
built AS (
  SELECT
    mem.*,
    s.product_code,
    s.branch_code,
    lpad(LEAST(GREATEST(COALESCE(NULLIF(regexp_replace(s.branch_code, '\D', '', 'g'), ''), regexp_replace(s.branch_value, '\D', '', 'g'), '0')::bigint, 0), (10 ^ s.branch_digit_count) - 1)::text, s.branch_digit_count, '0') AS seg_branch,
    lpad(LEAST(GREATEST(COALESCE(NULLIF(regexp_replace(s.product_code, '\D', '', 'g'), ''), '0')::bigint, 0), (10 ^ s.account_type_digit_count) - 1)::text, s.account_type_digit_count, '0') AS seg_product,
    lpad(LEAST(GREATEST(mem.serial_n, 0), (10 ^ s.serial_digit_count) - 1)::text, s.serial_digit_count, '0') AS seg_serial,
    s.separator
  FROM members mem
  CROSS JOIN settings s
),
numbered AS (
  SELECT
    b.*,
    p.organization_id,
    CASE WHEN b.separator IS NULL OR b.separator = '' THEN b.seg_branch || b.seg_product || b.seg_serial
         ELSE b.seg_branch || b.separator || b.seg_product || b.separator || b.seg_serial END AS account_number
  FROM built b
  CROSS JOIN params p
),
to_insert AS (
  SELECT n.*
  FROM numbered n
  WHERE NOT EXISTS (
    SELECT 1 FROM public.sacco_member_savings_accounts a
    WHERE a.organization_id = n.organization_id AND a.sacco_member_id = n.sacco_member_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.sacco_member_savings_accounts a
    WHERE a.organization_id = n.organization_id AND a.account_number = n.account_number
  )
)
INSERT INTO public.sacco_member_savings_accounts (
  organization_id,
  sacco_member_id,
  savings_product_code,
  account_number,
  branch_code,
  date_account_opened,
  client_no,
  client_full_name,
  gender,
  date_of_birth,
  marital_status,
  address,
  telephone,
  email,
  occupation,
  next_of_kin,
  nok_phone,
  balance,
  is_active
)
SELECT
  organization_id,
  sacco_member_id,
  product_code,
  account_number,
  branch_code,
  CURRENT_DATE,
  member_number,
  full_name,
  gender,
  date_of_birth,
  marital_status,
  address,
  phone,
  email,
  occupation,
  next_of_kin,
  nok_phone,
  0,
  true
FROM to_insert;
*/

-- =============================================================================
-- ALTERNATE: paste explicit member_id | member_number pairs (from your query export)
-- =============================================================================
/*
CREATE TEMP TABLE import_member_ids (
  sacco_member_id uuid PRIMARY KEY,
  member_number text NOT NULL
) ON COMMIT DROP;

-- Paste rows from: SELECT id, member_number FROM sacco_members WHERE organization_id = '4b550bfd-...'
INSERT INTO import_member_ids (sacco_member_id, member_number) VALUES
  ('8579720b-0692-4913-9031-649033284074'::uuid, '1'),
  ('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'::uuid, '2');
  -- …

-- Then join import_member_ids to settings the same way as STEP 1 preview.
*/
