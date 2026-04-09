-- Retail chart of accounts seed (per organization) + multi-tenant-safe account_code uniqueness
--
-- After migration, call from SQL (replace with your organization UUID):
--   SELECT public.seed_retail_chart_of_accounts('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'::uuid);

-- 1) Replace global UNIQUE(account_code) with per-organization uniqueness
ALTER TABLE public.gl_accounts DROP CONSTRAINT IF EXISTS gl_accounts_account_code_key;

CREATE UNIQUE INDEX IF NOT EXISTS gl_accounts_org_account_code_unique
  ON public.gl_accounts (organization_id, account_code)
  WHERE organization_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gl_accounts_legacy_account_code_unique
  ON public.gl_accounts (account_code)
  WHERE organization_id IS NULL;

-- 2) Preserve explicit organization_id on insert (so seeds / migrations can target a tenant)
CREATE OR REPLACE FUNCTION public.set_gl_account_org_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.organization_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT organization_id
  INTO NEW.organization_id
  FROM public.staff
  WHERE id = auth.uid();
  RETURN NEW;
END;
$$;

-- 3) Seed function: retail-oriented chart of accounts for one organization
CREATE OR REPLACE FUNCTION public.seed_retail_chart_of_accounts(p_organization_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m jsonb := '{}'::jsonb;
  new_id uuid;
  inserted int := 0;
  r record;
  pid uuid;
  v_rev uuid;
  v_cash uuid;
  v_rec uuid;
  v_exp uuid;
  v_pay uuid;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization_id is required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_organization_id) THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = auth.uid() AND s.organization_id = p_organization_id
    ) AND NOT EXISTS (
      SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
  END IF;

  FOR r IN
    SELECT * FROM (
      VALUES
        ('1000', 'Assets', 'asset', 'other', NULL::text),
        ('2000', 'Liabilities', 'liability', 'other', NULL::text),
        ('3000', 'Equity', 'equity', 'other', NULL::text),
        ('4000', 'Revenue', 'income', 'revenue', NULL::text),
        ('6000', 'Expenses', 'expense', 'other', NULL::text),
        ('1100', 'Current Assets', 'asset', 'other', '1000'),
        ('1200', 'Non-Current Assets', 'asset', 'other', '1000'),
        ('2100', 'Current Liabilities', 'liability', 'other', '2000'),
        ('2200', 'Long-Term Liabilities', 'liability', 'other', '2000'),
        ('3100', 'Owner Capital', 'equity', 'other', '3000'),
        ('3200', 'Retained Earnings', 'equity', 'other', '3000'),
        ('3300', 'Drawings', 'equity', 'other', '3000'),
        ('4100', 'Retail Sales', 'income', 'revenue', '4000'),
        ('4110', 'Beverage Sales', 'income', 'revenue', '4000'),
        ('4120', 'Food Sales', 'income', 'revenue', '4000'),
        ('4200', 'Other Income', 'income', 'other', '4000'),
        ('6100', 'Salaries & Wages', 'expense', 'expense', '6000'),
        ('6200', 'Rent Expense', 'expense', 'expense', '6000'),
        ('6300', 'Utilities', 'expense', 'expense', '6000'),
        ('6400', 'Bank Charges', 'expense', 'expense', '6000'),
        ('6500', 'Transport & Delivery', 'expense', 'expense', '6000'),
        ('6600', 'Advertising & Promotion', 'expense', 'expense', '6000'),
        ('6700', 'Depreciation Expense', 'expense', 'expense', '6000'),
        ('8000', 'Inventory Loss/Shrinkage', 'expense', 'expense', '6000'),
        ('1110', 'Cash on Hand', 'asset', 'cash', '1100'),
        ('1120', 'Bank Account - Main', 'asset', 'cash', '1100'),
        ('1130', 'Mobile Money Account', 'asset', 'cash', '1100'),
        ('1140', 'Accounts Receivable', 'asset', 'receivable', '1100'),
        ('1150', 'Inventory - Shop Floor', 'asset', 'inventory', '1100'),
        ('1160', 'Inventory - Store', 'asset', 'inventory', '1100'),
        ('1210', 'Furniture & Fittings', 'asset', 'other', '1200'),
        ('1220', 'POS Equipment', 'asset', 'other', '1200'),
        ('1240', 'Accumulated Depreciation', 'asset', 'other', '1200'),
        ('2110', 'Accounts Payable', 'liability', 'payable', '2100'),
        ('2120', 'Customer Deposits', 'liability', 'other', '2100'),
        ('2130', 'Taxes Payable', 'liability', 'other', '2100'),
        ('2140', 'Short-Term Loans', 'liability', 'other', '2100'),
        ('5000', 'Cost of Goods Sold', 'expense', 'cogs', '6000')
    ) AS v(account_code, account_name, account_type, category, parent_code)
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.gl_accounts ga
      WHERE ga.organization_id = p_organization_id AND ga.account_code = r.account_code
    ) THEN
      SELECT ga.id INTO new_id
      FROM public.gl_accounts ga
      WHERE ga.organization_id = p_organization_id AND ga.account_code = r.account_code
      LIMIT 1;
      m := m || jsonb_build_object(r.account_code, new_id::text);
      CONTINUE;
    END IF;

    pid := NULL;
    IF r.parent_code IS NOT NULL THEN
      IF m ? r.parent_code THEN
        pid := (m->>r.parent_code)::uuid;
      ELSE
        SELECT ga.id INTO pid
        FROM public.gl_accounts ga
        WHERE ga.organization_id = p_organization_id AND ga.account_code = r.parent_code
        LIMIT 1;
      END IF;
      IF pid IS NULL THEN
        RAISE EXCEPTION 'Parent account % not found for %', r.parent_code, r.account_code;
      END IF;
    END IF;

    new_id := gen_random_uuid();
    INSERT INTO public.gl_accounts (
      id, account_code, account_name, account_type, category, parent_id, organization_id
    ) VALUES (
      new_id,
      r.account_code,
      r.account_name,
      r.account_type,
      r.category,
      pid,
      p_organization_id
    );
    inserted := inserted + 1;
    m := m || jsonb_build_object(r.account_code, new_id::text);
  END LOOP;

  SELECT id INTO v_rev FROM public.gl_accounts
  WHERE organization_id = p_organization_id AND account_code = '4100' LIMIT 1;
  SELECT id INTO v_cash FROM public.gl_accounts
  WHERE organization_id = p_organization_id AND account_code = '1120' LIMIT 1;
  SELECT id INTO v_rec FROM public.gl_accounts
  WHERE organization_id = p_organization_id AND account_code = '1140' LIMIT 1;
  SELECT id INTO v_exp FROM public.gl_accounts
  WHERE organization_id = p_organization_id AND account_code = '6100' LIMIT 1;
  SELECT id INTO v_pay FROM public.gl_accounts
  WHERE organization_id = p_organization_id AND account_code = '2110' LIMIT 1;

  INSERT INTO public.journal_gl_settings (
    organization_id,
    revenue_gl_account_id,
    cash_gl_account_id,
    receivable_gl_account_id,
    expense_gl_account_id,
    payable_gl_account_id
  ) VALUES (
    p_organization_id,
    v_rev,
    v_cash,
    v_rec,
    v_exp,
    v_pay
  )
  ON CONFLICT (organization_id) DO UPDATE SET
    revenue_gl_account_id = COALESCE(journal_gl_settings.revenue_gl_account_id, EXCLUDED.revenue_gl_account_id),
    cash_gl_account_id = COALESCE(journal_gl_settings.cash_gl_account_id, EXCLUDED.cash_gl_account_id),
    receivable_gl_account_id = COALESCE(journal_gl_settings.receivable_gl_account_id, EXCLUDED.receivable_gl_account_id),
    expense_gl_account_id = COALESCE(journal_gl_settings.expense_gl_account_id, EXCLUDED.expense_gl_account_id),
    payable_gl_account_id = COALESCE(journal_gl_settings.payable_gl_account_id, EXCLUDED.payable_gl_account_id),
    updated_at = now();

  RETURN inserted;
END;
$$;

COMMENT ON FUNCTION public.seed_retail_chart_of_accounts(uuid) IS
  'Inserts the standard retail chart of accounts for one organization (skips existing codes). Sets journal_gl_settings defaults when empty.';

GRANT EXECUTE ON FUNCTION public.seed_retail_chart_of_accounts(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seed_retail_chart_of_accounts(uuid) TO service_role;
