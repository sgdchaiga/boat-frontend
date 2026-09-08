-- Standard school chart of accounts.
-- Idempotent: existing codes and all administrator-created accounts are preserved.

CREATE OR REPLACE FUNCTION public.seed_school_chart_of_accounts(p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_id uuid;
  v_parent_id uuid;
  account_ids jsonb := '{}'::jsonb;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization_id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = p_organization_id AND lower(COALESCE(business_type, '')) = 'school'
  ) THEN
    RAISE EXCEPTION 'Organization is not a school';
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('1000','Assets','asset','other',NULL::text),
      ('1100','Current Assets','asset','other','1000'),
      ('1110','Cash on Hand','asset','cash','1100'),
      ('1120','Bank Accounts','asset','cash','1100'),
      ('1130','Mobile Money Accounts','asset','cash','1100'),
      ('1140','School Fees Receivable','asset','receivable','1100'),
      ('1150','Staff Advances and Imprests','asset','receivable','1100'),
      ('1160','Prepayments and Deposits','asset','other','1100'),
      ('1170','School Stores and Supplies','asset','inventory','1100'),
      ('1180','Wallet Clearing Account','asset','cash','1100'),
      ('1200','Non-Current Assets','asset','other','1000'),
      ('1210','Land','asset','other','1200'),
      ('1220','School Buildings','asset','other','1200'),
      ('1230','Furniture and Fittings','asset','other','1200'),
      ('1240','Computers and ICT Equipment','asset','other','1200'),
      ('1250','Laboratory and Teaching Equipment','asset','other','1200'),
      ('1260','Motor Vehicles and School Buses','asset','other','1200'),
      ('1290','Accumulated Depreciation','asset','other','1200'),

      ('2000','Liabilities','liability','other',NULL::text),
      ('2100','Current Liabilities','liability','other','2000'),
      ('2110','Suppliers Payable','liability','payable','2100'),
      ('2120','Accrued Expenses','liability','payable','2100'),
      ('2130','Payroll and Statutory Deductions Payable','liability','payable','2100'),
      ('2140','Taxes Payable','liability','payable','2100'),
      ('2150','Fees Received in Advance','liability','other','2100'),
      ('2160','Student Wallet Balances','liability','payable','2100'),
      ('2200','Long-Term Liabilities','liability','other','2000'),
      ('2210','Bank and Development Loans','liability','payable','2200'),

      ('3000','School Funds and Reserves','equity','other',NULL::text),
      ('3100','Accumulated Fund / Capital','equity','other','3000'),
      ('3200','Retained Surplus or Deficit','equity','other','3000'),
      ('3300','Capital Grants Reserve','equity','other','3000'),

      ('4000','School Income','income','revenue',NULL::text),
      ('4100','Tuition Fees','income','revenue','4000'),
      ('4110','Boarding Fees','income','revenue','4000'),
      ('4120','Meals and Catering Fees','income','revenue','4000'),
      ('4130','School Transport Fees','income','revenue','4000'),
      ('4140','Uniforms, Books and Supplies Income','income','revenue','4000'),
      ('4150','Admission and Registration Fees','income','revenue','4000'),
      ('4160','Examination and Academic Activity Fees','income','revenue','4000'),
      ('4170','Sports, Clubs and Trip Income','income','revenue','4000'),
      ('4180','Government Grants and Capitation','income','revenue','4000'),
      ('4190','Donations and Development Income','income','revenue','4000'),
      ('4200','Other School Income','income','other','4000'),
      ('4210','Interest and Investment Income','income','other','4000'),

      ('5000','Education and Student Costs','expense','expense',NULL::text),
      ('5100','Teaching Staff Salaries and Wages','expense','expense','5000'),
      ('5110','Teaching and Learning Materials','expense','expense','5000'),
      ('5120','Examinations and Assessment Costs','expense','expense','5000'),
      ('5130','Laboratory and Practical Materials','expense','expense','5000'),
      ('5140','Library and Textbook Costs','expense','expense','5000'),
      ('5150','ICT and E-Learning Costs','expense','expense','5000'),
      ('5160','Sports, Clubs and Student Activities','expense','expense','5000'),
      ('5170','Boarding Food and Student Welfare','expense','expense','5000'),
      ('5180','Student Medical and Health Costs','expense','expense','5000'),
      ('5190','Bursaries, Scholarships and Fee Waivers','expense','expense','5000'),

      ('6000','Administration and Operating Expenses','expense','expense',NULL::text),
      ('6100','Non-Teaching Staff Salaries and Wages','expense','expense','6000'),
      ('6110','Employer Statutory Contributions','expense','expense','6000'),
      ('6120','Staff Training and Welfare','expense','expense','6000'),
      ('6200','Stationery, Printing and Office Supplies','expense','expense','6000'),
      ('6210','Telephone, Internet and Communication','expense','expense','6000'),
      ('6220','Professional, Legal and Audit Fees','expense','expense','6000'),
      ('6230','Bank and Mobile Money Charges','expense','expense','6000'),
      ('6240','Insurance','expense','expense','6000'),
      ('6250','Licences, Subscriptions and Memberships','expense','expense','6000'),
      ('6300','Electricity and Power','expense','expense','6000'),
      ('6310','Water and Sanitation','expense','expense','6000'),
      ('6320','Rent and Property Costs','expense','expense','6000'),
      ('6330','Cleaning and Waste Management','expense','expense','6000'),
      ('6340','Security Expenses','expense','expense','6000'),
      ('6400','Repairs and Maintenance - Buildings','expense','expense','6000'),
      ('6410','Repairs and Maintenance - Equipment','expense','expense','6000'),
      ('6420','Repairs and Maintenance - Vehicles','expense','expense','6000'),
      ('6500','Fuel and Lubricants','expense','expense','6000'),
      ('6510','Transport and Travel','expense','expense','6000'),
      ('6600','Advertising, Admissions and Publicity','expense','expense','6000'),
      ('6700','Depreciation Expense','expense','expense','6000'),
      ('6800','Bad Debts and Receivable Write-Offs','expense','expense','6000'),
      ('6900','General and Miscellaneous Expenses','expense','expense','6000'),
      ('6910','Inventory Loss, Damage and Expiry','expense','expense','6000')
    ) AS x(account_code, account_name, account_type, category, parent_code)
  LOOP
    SELECT id INTO v_id
    FROM public.gl_accounts
    WHERE organization_id = p_organization_id AND account_code = r.account_code
    LIMIT 1;

    v_parent_id := NULL;
    IF r.parent_code IS NOT NULL THEN
      v_parent_id := (account_ids->>r.parent_code)::uuid;
      IF v_parent_id IS NULL THEN
        SELECT id INTO v_parent_id FROM public.gl_accounts
        WHERE organization_id = p_organization_id AND account_code = r.parent_code
        LIMIT 1;
      END IF;
    END IF;

    IF v_id IS NULL THEN
      INSERT INTO public.gl_accounts(
        id, organization_id, account_code, account_name, account_type, category, parent_id, is_active, business_type
      ) VALUES (
        gen_random_uuid(), p_organization_id, r.account_code, r.account_name,
        r.account_type, r.category, v_parent_id, true, 'school'
      ) RETURNING id INTO v_id;
    ELSE
      -- Convert legacy mixed-industry defaults to the school standard while
      -- preserving the administrator-controlled active/inactive state.
      UPDATE public.gl_accounts SET
        account_name = r.account_name,
        account_type = r.account_type,
        category = r.category,
        parent_id = v_parent_id,
        business_type = 'school'
      WHERE id = v_id;
    END IF;
    account_ids := account_ids || jsonb_build_object(r.account_code, v_id::text);
  END LOOP;

  INSERT INTO public.journal_gl_settings(
    organization_id, revenue_gl_account_id, cash_gl_account_id, receivable_gl_account_id,
    expense_gl_account_id, payable_gl_account_id, purchases_inventory_gl_account_id,
    pos_bank_gl_account_id, pos_mtn_mobile_money_gl_account_id, pos_airtel_money_gl_account_id,
    depreciation_expense_gl_account_id, accumulated_depreciation_gl_account_id,
    fixed_asset_cost_gl_account_id, retained_earnings_gl_account_id,
    wallet_liability_gl_account_id, wallet_clearing_gl_account_id, updated_at
  ) VALUES (
    p_organization_id, (account_ids->>'4100')::uuid, (account_ids->>'1110')::uuid,
    (account_ids->>'1140')::uuid, (account_ids->>'5100')::uuid, (account_ids->>'2110')::uuid,
    (account_ids->>'1170')::uuid, (account_ids->>'1120')::uuid, (account_ids->>'1130')::uuid,
    (account_ids->>'1130')::uuid, (account_ids->>'6700')::uuid, (account_ids->>'1290')::uuid,
    (account_ids->>'1220')::uuid, (account_ids->>'3200')::uuid,
    (account_ids->>'2160')::uuid, (account_ids->>'1180')::uuid, now()
  )
  ON CONFLICT (organization_id) DO UPDATE SET
    revenue_gl_account_id = EXCLUDED.revenue_gl_account_id,
    cash_gl_account_id = EXCLUDED.cash_gl_account_id,
    receivable_gl_account_id = EXCLUDED.receivable_gl_account_id,
    expense_gl_account_id = EXCLUDED.expense_gl_account_id,
    payable_gl_account_id = EXCLUDED.payable_gl_account_id,
    purchases_inventory_gl_account_id = EXCLUDED.purchases_inventory_gl_account_id,
    pos_bank_gl_account_id = EXCLUDED.pos_bank_gl_account_id,
    pos_mtn_mobile_money_gl_account_id = EXCLUDED.pos_mtn_mobile_money_gl_account_id,
    pos_airtel_money_gl_account_id = EXCLUDED.pos_airtel_money_gl_account_id,
    depreciation_expense_gl_account_id = EXCLUDED.depreciation_expense_gl_account_id,
    accumulated_depreciation_gl_account_id = EXCLUDED.accumulated_depreciation_gl_account_id,
    fixed_asset_cost_gl_account_id = EXCLUDED.fixed_asset_cost_gl_account_id,
    retained_earnings_gl_account_id = EXCLUDED.retained_earnings_gl_account_id,
    wallet_liability_gl_account_id = EXCLUDED.wallet_liability_gl_account_id,
    wallet_clearing_gl_account_id = EXCLUDED.wallet_clearing_gl_account_id,
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.seed_school_chart_of_accounts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_school_chart_of_accounts(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.seed_school_chart_on_organization_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF lower(COALESCE(NEW.business_type, '')) = 'school' THEN
    PERFORM public.seed_school_chart_of_accounts(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_organizations_school_chart ON public.organizations;
CREATE TRIGGER trg_organizations_school_chart
AFTER INSERT OR UPDATE OF business_type ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.seed_school_chart_on_organization_change();

DO $$
DECLARE school_org record;
BEGIN
  FOR school_org IN SELECT id FROM public.organizations WHERE lower(COALESCE(business_type, '')) = 'school'
  LOOP
    PERFORM public.seed_school_chart_of_accounts(school_org.id);
  END LOOP;
END $$;

COMMENT ON FUNCTION public.seed_school_chart_of_accounts(uuid) IS
  'Idempotently installs the standard school chart and school posting defaults without deleting custom accounts.';
