CREATE OR REPLACE FUNCTION public.ensure_organization_standard_setup(
  p_organization_id uuid,
  p_business_type text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  bt text;
  r record;
  centre record;
  rule record;
  new_id uuid;
  parent_uuid uuid;
  acc jsonb := '{}'::jsonb;
  centre_ids jsonb := '{}'::jsonb;
  rule_id uuid;
  current_period text := to_char(current_date, 'YYYY-MM');
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization_id is required';
  END IF;

  SELECT lower(COALESCE(p_business_type, business_type, 'other'))
  INTO bt
  FROM public.organizations
  WHERE id = p_organization_id;

  IF bt IS NULL THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  FOR r IN
    SELECT * FROM (
      VALUES
        ('1000', 'Assets', 'asset', 'other', NULL::text),
        ('1100', 'Current Assets', 'asset', 'other', '1000'),
        ('1110', 'Cash on Hand', 'asset', 'cash', '1100'),
        ('1120', 'Bank Account - Main', 'asset', 'cash', '1100'),
        ('1130', 'Mobile Money Account', 'asset', 'cash', '1100'),
        ('1140', 'Accounts Receivable', 'asset', 'receivable', '1100'),
        ('1150', 'Inventory', 'asset', 'inventory', '1100'),
        ('1160', 'Prepayments', 'asset', 'other', '1100'),
        ('1170', 'Work in Progress', 'asset', 'inventory', '1100'),
        ('1171', 'Raw Materials Inventory', 'asset', 'inventory', '1100'),
        ('1172', 'Finished Goods Inventory', 'asset', 'inventory', '1100'),
        ('1200', 'Non-Current Assets', 'asset', 'other', '1000'),
        ('1210', 'Furniture & Fittings', 'asset', 'other', '1200'),
        ('1220', 'Plant & Equipment', 'asset', 'other', '1200'),
        ('1230', 'Motor Vehicles', 'asset', 'other', '1200'),
        ('1240', 'Accumulated Depreciation', 'asset', 'other', '1200'),
        ('2000', 'Liabilities', 'liability', 'other', NULL::text),
        ('2100', 'Current Liabilities', 'liability', 'other', '2000'),
        ('2110', 'Accounts Payable', 'liability', 'payable', '2100'),
        ('2120', 'Customer Deposits', 'liability', 'other', '2100'),
        ('2130', 'Taxes Payable', 'liability', 'other', '2100'),
        ('2140', 'Wages Payable', 'liability', 'payable', '2100'),
        ('2150', 'Wallet / Member Deposits Payable', 'liability', 'payable', '2100'),
        ('2200', 'Long-Term Liabilities', 'liability', 'other', '2000'),
        ('3000', 'Equity', 'equity', 'other', NULL::text),
        ('3100', 'Owner Capital', 'equity', 'other', '3000'),
        ('3200', 'Retained Earnings', 'equity', 'other', '3000'),
        ('3300', 'Drawings / Distributions', 'equity', 'other', '3000'),
        ('4000', 'Revenue', 'income', 'revenue', NULL::text),
        ('4100', 'Sales / Service Revenue', 'income', 'revenue', '4000'),
        ('4110', 'Rooms Revenue', 'income', 'revenue', '4000'),
        ('4120', 'Food & Beverage Revenue', 'income', 'revenue', '4000'),
        ('4130', 'School Fees Revenue', 'income', 'revenue', '4000'),
        ('4140', 'Interest & Fee Income', 'income', 'revenue', '4000'),
        ('4150', 'Clinic Service Revenue', 'income', 'revenue', '4000'),
        ('4200', 'Other Income', 'income', 'other', '4000'),
        ('4210', 'Inventory Variance Gain', 'income', 'other', '4000'),
        ('5000', 'Cost of Sales', 'expense', 'cogs', NULL::text),
        ('5100', 'Cost of Goods Sold', 'expense', 'cogs', '5000'),
        ('5110', 'Food Cost of Sales', 'expense', 'cogs', '5000'),
        ('5120', 'Beverage Cost of Sales', 'expense', 'cogs', '5000'),
        ('5130', 'Manufacturing Cost of Sales', 'expense', 'cogs', '5000'),
        ('6000', 'Operating Expenses', 'expense', 'other', NULL::text),
        ('6100', 'Salaries & Wages', 'expense', 'expense', '6000'),
        ('6200', 'Rent Expense', 'expense', 'expense', '6000'),
        ('6300', 'Utilities', 'expense', 'expense', '6000'),
        ('6400', 'Bank Charges', 'expense', 'expense', '6000'),
        ('6500', 'Transport & Delivery', 'expense', 'expense', '6000'),
        ('6600', 'Advertising & Promotion', 'expense', 'expense', '6000'),
        ('6700', 'Depreciation Expense', 'expense', 'expense', '6000'),
        ('6800', 'Factory Overhead Applied', 'expense', 'expense', '6000'),
        ('6900', 'Allocated Department Overheads', 'expense', 'expense', '6000'),
        ('8000', 'Inventory Loss / Shrinkage', 'expense', 'expense', '6000'),
        ('8010', 'Damaged Goods Expense', 'expense', 'expense', '6000'),
        ('8020', 'Expired Stock Expense', 'expense', 'expense', '6000'),
        ('8030', 'Internal Consumption Expense', 'expense', 'expense', '6000')
    ) AS v(account_code, account_name, account_type, category, parent_code)
  LOOP
    SELECT id INTO new_id
    FROM public.gl_accounts
    WHERE organization_id = p_organization_id AND account_code = r.account_code
    LIMIT 1;

    IF new_id IS NULL THEN
      parent_uuid := NULL;
      IF r.parent_code IS NOT NULL THEN
        parent_uuid := (acc->>r.parent_code)::uuid;
        IF parent_uuid IS NULL THEN
          SELECT id INTO parent_uuid
          FROM public.gl_accounts
          WHERE organization_id = p_organization_id AND account_code = r.parent_code
          LIMIT 1;
        END IF;
      END IF;

      INSERT INTO public.gl_accounts (
        id,
        organization_id,
        account_code,
        account_name,
        account_type,
        category,
        parent_id,
        is_active
      )
      VALUES (
        gen_random_uuid(),
        p_organization_id,
        r.account_code,
        r.account_name,
        r.account_type,
        r.category,
        parent_uuid,
        true
      )
      RETURNING id INTO new_id;
    END IF;

    acc := acc || jsonb_build_object(r.account_code, new_id::text);
  END LOOP;

  INSERT INTO public.journal_gl_settings (
    organization_id,
    revenue_gl_account_id,
    cash_gl_account_id,
    receivable_gl_account_id,
    expense_gl_account_id,
    payable_gl_account_id,
    purchases_inventory_gl_account_id,
    pos_bank_gl_account_id,
    pos_mtn_mobile_money_gl_account_id,
    pos_airtel_money_gl_account_id,
    pos_cogs_bar_gl_account_id,
    pos_inventory_bar_gl_account_id,
    pos_cogs_kitchen_gl_account_id,
    pos_inventory_kitchen_gl_account_id,
    pos_cogs_room_gl_account_id,
    pos_inventory_room_gl_account_id,
    pos_revenue_bar_gl_account_id,
    pos_revenue_kitchen_gl_account_id,
    pos_revenue_room_gl_account_id,
    fixed_asset_cost_gl_account_id,
    accumulated_depreciation_gl_account_id,
    depreciation_expense_gl_account_id,
    retained_earnings_gl_account_id,
    wallet_liability_gl_account_id,
    wallet_clearing_gl_account_id,
    manufacturing_finished_goods_gl_account_id,
    manufacturing_wip_gl_account_id,
    manufacturing_raw_materials_gl_account_id,
    manufacturing_wages_payable_gl_account_id,
    manufacturing_overhead_gl_account_id,
    manufacturing_consumables_expense_gl_account_id,
    manufacturing_scrap_inventory_gl_account_id,
    pos_agent_commission_expense_gl_account_id,
    pos_transport_expense_gl_account_id,
    stock_adjustment_inventory_variance_expense_gl_account_id,
    stock_adjustment_inventory_variance_gain_gl_account_id,
    stock_adjustment_damaged_goods_expense_gl_account_id,
    stock_adjustment_inventory_shrinkage_expense_gl_account_id,
    stock_adjustment_expired_stock_expense_gl_account_id,
    stock_adjustment_internal_consumption_expense_gl_account_id,
    stock_adjustment_work_in_progress_gl_account_id,
    stock_adjustment_raw_materials_inventory_gl_account_id,
    stock_adjustment_finished_goods_inventory_gl_account_id,
    default_vat_percent,
    updated_at
  )
  VALUES (
    p_organization_id,
    (acc->>(CASE
      WHEN bt = 'school' THEN '4130'
      WHEN bt IN ('sacco', 'vsla') THEN '4140'
      WHEN bt = 'clinic' THEN '4150'
      WHEN bt = 'hotel' THEN '4110'
      WHEN bt = 'restaurant' THEN '4120'
      ELSE '4100'
    END))::uuid,
    (acc->>'1120')::uuid,
    (acc->>'1140')::uuid,
    (acc->>'6100')::uuid,
    (acc->>'2110')::uuid,
    (acc->>(CASE WHEN bt = 'manufacturing' THEN '1171' ELSE '1150' END))::uuid,
    (acc->>'1120')::uuid,
    (acc->>'1130')::uuid,
    (acc->>'1130')::uuid,
    (acc->>(CASE WHEN bt = 'restaurant' THEN '5110' ELSE '5120' END))::uuid,
    (acc->>'1150')::uuid,
    (acc->>(CASE WHEN bt = 'manufacturing' THEN '5130' ELSE '5110' END))::uuid,
    (acc->>'1150')::uuid,
    (acc->>'5100')::uuid,
    (acc->>'1150')::uuid,
    (acc->>'4120')::uuid,
    (acc->>'4120')::uuid,
    (acc->>'4110')::uuid,
    (acc->>'1220')::uuid,
    (acc->>'1240')::uuid,
    (acc->>'6700')::uuid,
    (acc->>'3200')::uuid,
    (acc->>'2150')::uuid,
    (acc->>'1120')::uuid,
    (acc->>'1172')::uuid,
    (acc->>'1170')::uuid,
    (acc->>'1171')::uuid,
    (acc->>'2140')::uuid,
    (acc->>'6800')::uuid,
    (acc->>'8030')::uuid,
    (acc->>'1150')::uuid,
    (acc->>'6500')::uuid,
    (acc->>'6500')::uuid,
    (acc->>'8000')::uuid,
    (acc->>'4210')::uuid,
    (acc->>'8010')::uuid,
    (acc->>'8000')::uuid,
    (acc->>'8020')::uuid,
    (acc->>'8030')::uuid,
    (acc->>'1170')::uuid,
    (acc->>'1171')::uuid,
    (acc->>'1172')::uuid,
    18,
    now()
  )
  ON CONFLICT (organization_id) DO UPDATE SET
    revenue_gl_account_id = COALESCE(journal_gl_settings.revenue_gl_account_id, EXCLUDED.revenue_gl_account_id),
    cash_gl_account_id = COALESCE(journal_gl_settings.cash_gl_account_id, EXCLUDED.cash_gl_account_id),
    receivable_gl_account_id = COALESCE(journal_gl_settings.receivable_gl_account_id, EXCLUDED.receivable_gl_account_id),
    expense_gl_account_id = COALESCE(journal_gl_settings.expense_gl_account_id, EXCLUDED.expense_gl_account_id),
    payable_gl_account_id = COALESCE(journal_gl_settings.payable_gl_account_id, EXCLUDED.payable_gl_account_id),
    purchases_inventory_gl_account_id = COALESCE(journal_gl_settings.purchases_inventory_gl_account_id, EXCLUDED.purchases_inventory_gl_account_id),
    pos_bank_gl_account_id = COALESCE(journal_gl_settings.pos_bank_gl_account_id, EXCLUDED.pos_bank_gl_account_id),
    pos_mtn_mobile_money_gl_account_id = COALESCE(journal_gl_settings.pos_mtn_mobile_money_gl_account_id, EXCLUDED.pos_mtn_mobile_money_gl_account_id),
    pos_airtel_money_gl_account_id = COALESCE(journal_gl_settings.pos_airtel_money_gl_account_id, EXCLUDED.pos_airtel_money_gl_account_id),
    pos_cogs_bar_gl_account_id = COALESCE(journal_gl_settings.pos_cogs_bar_gl_account_id, EXCLUDED.pos_cogs_bar_gl_account_id),
    pos_inventory_bar_gl_account_id = COALESCE(journal_gl_settings.pos_inventory_bar_gl_account_id, EXCLUDED.pos_inventory_bar_gl_account_id),
    pos_cogs_kitchen_gl_account_id = COALESCE(journal_gl_settings.pos_cogs_kitchen_gl_account_id, EXCLUDED.pos_cogs_kitchen_gl_account_id),
    pos_inventory_kitchen_gl_account_id = COALESCE(journal_gl_settings.pos_inventory_kitchen_gl_account_id, EXCLUDED.pos_inventory_kitchen_gl_account_id),
    pos_cogs_room_gl_account_id = COALESCE(journal_gl_settings.pos_cogs_room_gl_account_id, EXCLUDED.pos_cogs_room_gl_account_id),
    pos_inventory_room_gl_account_id = COALESCE(journal_gl_settings.pos_inventory_room_gl_account_id, EXCLUDED.pos_inventory_room_gl_account_id),
    pos_revenue_bar_gl_account_id = COALESCE(journal_gl_settings.pos_revenue_bar_gl_account_id, EXCLUDED.pos_revenue_bar_gl_account_id),
    pos_revenue_kitchen_gl_account_id = COALESCE(journal_gl_settings.pos_revenue_kitchen_gl_account_id, EXCLUDED.pos_revenue_kitchen_gl_account_id),
    pos_revenue_room_gl_account_id = COALESCE(journal_gl_settings.pos_revenue_room_gl_account_id, EXCLUDED.pos_revenue_room_gl_account_id),
    fixed_asset_cost_gl_account_id = COALESCE(journal_gl_settings.fixed_asset_cost_gl_account_id, EXCLUDED.fixed_asset_cost_gl_account_id),
    accumulated_depreciation_gl_account_id = COALESCE(journal_gl_settings.accumulated_depreciation_gl_account_id, EXCLUDED.accumulated_depreciation_gl_account_id),
    depreciation_expense_gl_account_id = COALESCE(journal_gl_settings.depreciation_expense_gl_account_id, EXCLUDED.depreciation_expense_gl_account_id),
    retained_earnings_gl_account_id = COALESCE(journal_gl_settings.retained_earnings_gl_account_id, EXCLUDED.retained_earnings_gl_account_id),
    wallet_liability_gl_account_id = COALESCE(journal_gl_settings.wallet_liability_gl_account_id, EXCLUDED.wallet_liability_gl_account_id),
    wallet_clearing_gl_account_id = COALESCE(journal_gl_settings.wallet_clearing_gl_account_id, EXCLUDED.wallet_clearing_gl_account_id),
    manufacturing_finished_goods_gl_account_id = COALESCE(journal_gl_settings.manufacturing_finished_goods_gl_account_id, EXCLUDED.manufacturing_finished_goods_gl_account_id),
    manufacturing_wip_gl_account_id = COALESCE(journal_gl_settings.manufacturing_wip_gl_account_id, EXCLUDED.manufacturing_wip_gl_account_id),
    manufacturing_raw_materials_gl_account_id = COALESCE(journal_gl_settings.manufacturing_raw_materials_gl_account_id, EXCLUDED.manufacturing_raw_materials_gl_account_id),
    manufacturing_wages_payable_gl_account_id = COALESCE(journal_gl_settings.manufacturing_wages_payable_gl_account_id, EXCLUDED.manufacturing_wages_payable_gl_account_id),
    manufacturing_overhead_gl_account_id = COALESCE(journal_gl_settings.manufacturing_overhead_gl_account_id, EXCLUDED.manufacturing_overhead_gl_account_id),
    manufacturing_consumables_expense_gl_account_id = COALESCE(journal_gl_settings.manufacturing_consumables_expense_gl_account_id, EXCLUDED.manufacturing_consumables_expense_gl_account_id),
    manufacturing_scrap_inventory_gl_account_id = COALESCE(journal_gl_settings.manufacturing_scrap_inventory_gl_account_id, EXCLUDED.manufacturing_scrap_inventory_gl_account_id),
    pos_agent_commission_expense_gl_account_id = COALESCE(journal_gl_settings.pos_agent_commission_expense_gl_account_id, EXCLUDED.pos_agent_commission_expense_gl_account_id),
    pos_transport_expense_gl_account_id = COALESCE(journal_gl_settings.pos_transport_expense_gl_account_id, EXCLUDED.pos_transport_expense_gl_account_id),
    stock_adjustment_inventory_variance_expense_gl_account_id = COALESCE(journal_gl_settings.stock_adjustment_inventory_variance_expense_gl_account_id, EXCLUDED.stock_adjustment_inventory_variance_expense_gl_account_id),
    stock_adjustment_inventory_variance_gain_gl_account_id = COALESCE(journal_gl_settings.stock_adjustment_inventory_variance_gain_gl_account_id, EXCLUDED.stock_adjustment_inventory_variance_gain_gl_account_id),
    stock_adjustment_damaged_goods_expense_gl_account_id = COALESCE(journal_gl_settings.stock_adjustment_damaged_goods_expense_gl_account_id, EXCLUDED.stock_adjustment_damaged_goods_expense_gl_account_id),
    stock_adjustment_inventory_shrinkage_expense_gl_account_id = COALESCE(journal_gl_settings.stock_adjustment_inventory_shrinkage_expense_gl_account_id, EXCLUDED.stock_adjustment_inventory_shrinkage_expense_gl_account_id),
    stock_adjustment_expired_stock_expense_gl_account_id = COALESCE(journal_gl_settings.stock_adjustment_expired_stock_expense_gl_account_id, EXCLUDED.stock_adjustment_expired_stock_expense_gl_account_id),
    stock_adjustment_internal_consumption_expense_gl_account_id = COALESCE(journal_gl_settings.stock_adjustment_internal_consumption_expense_gl_account_id, EXCLUDED.stock_adjustment_internal_consumption_expense_gl_account_id),
    stock_adjustment_work_in_progress_gl_account_id = COALESCE(journal_gl_settings.stock_adjustment_work_in_progress_gl_account_id, EXCLUDED.stock_adjustment_work_in_progress_gl_account_id),
    stock_adjustment_raw_materials_inventory_gl_account_id = COALESCE(journal_gl_settings.stock_adjustment_raw_materials_inventory_gl_account_id, EXCLUDED.stock_adjustment_raw_materials_inventory_gl_account_id),
    stock_adjustment_finished_goods_inventory_gl_account_id = COALESCE(journal_gl_settings.stock_adjustment_finished_goods_inventory_gl_account_id, EXCLUDED.stock_adjustment_finished_goods_inventory_gl_account_id),
    default_vat_percent = COALESCE(journal_gl_settings.default_vat_percent, EXCLUDED.default_vat_percent),
    updated_at = now();

  FOR centre IN
    SELECT * FROM (
      VALUES
        ('admin', 'Administration', 'administration', 'all'),
        ('sales', 'Sales', 'sales', 'all'),
        ('support', 'Support', 'support', 'all'),
        ('rooms', 'Rooms / Front Desk', 'production', 'hotel,mixed'),
        ('fb', 'Food & Beverage', 'production', 'hotel,mixed,restaurant'),
        ('retail', 'Retail Shop', 'production', 'retail,mixed'),
        ('store', 'Store / Warehouse', 'support', 'retail,restaurant,manufacturing,mixed'),
        ('clinic', 'Clinical Services', 'production', 'clinic'),
        ('lab', 'Laboratory', 'production', 'clinic'),
        ('pharmacy', 'Pharmacy', 'production', 'clinic'),
        ('production', 'Production', 'production', 'manufacturing'),
        ('quality', 'Quality Control', 'support', 'manufacturing'),
        ('academic', 'Academic', 'production', 'school'),
        ('boarding', 'Boarding', 'support', 'school'),
        ('loans', 'Loans', 'production', 'sacco'),
        ('savings', 'Savings & Deposits', 'production', 'sacco'),
        ('groups', 'Member Groups', 'production', 'vsla'),
        ('practice', 'Client Services', 'production', 'accounting_practice')
    ) AS v(code, name, centre_type, applies_to)
    WHERE applies_to = 'all' OR position(bt in applies_to) > 0
  LOOP
    SELECT id INTO new_id
    FROM public.cost_allocation_centres
    WHERE organization_id = p_organization_id AND code = centre.code
    LIMIT 1;

    IF new_id IS NULL THEN
      INSERT INTO public.cost_allocation_centres (organization_id, code, name, centre_type, is_active)
      VALUES (p_organization_id, centre.code, centre.name, centre.centre_type, true)
      RETURNING id INTO new_id;
    END IF;

    centre_ids := centre_ids || jsonb_build_object(centre.code, new_id::text);
  END LOOP;

  FOR centre IN
    SELECT value::text AS centre_id
    FROM jsonb_each_text(centre_ids)
  LOOP
    INSERT INTO public.cost_allocation_driver_values (
      organization_id,
      period,
      cost_centre_id,
      basis,
      driver_value
    )
    SELECT p_organization_id, current_period, centre.centre_id::uuid, basis, 0
    FROM (
      VALUES ('floor_area'), ('headcount'), ('machine_hours'), ('labour_hours'), ('asset_value'), ('revenue')
    ) AS b(basis)
    ON CONFLICT (organization_id, period, cost_centre_id, basis) DO NOTHING;
  END LOOP;

  FOR rule IN
    SELECT * FROM (
      VALUES
        ('Rent by floor area', '6200', '6900', 'floor_area'),
        ('Utilities by floor area', '6300', '6900', 'floor_area'),
        ('Salaries by headcount', '6100', '6900', 'headcount'),
        ('Depreciation by asset value', '6700', '6900', 'asset_value'),
        ('Advertising by revenue', '6600', '6900', 'revenue'),
        ('Transport by revenue', '6500', '6900', 'revenue')
    ) AS v(name, expense_code, debit_code, basis)
  LOOP
    SELECT id INTO rule_id
    FROM public.cost_allocation_rules
    WHERE organization_id = p_organization_id
      AND expense_gl_account_id = (acc->>rule.expense_code)::uuid
      AND debit_gl_account_id = (acc->>rule.debit_code)::uuid
      AND basis = rule.basis
    LIMIT 1;

    IF rule_id IS NULL THEN
      INSERT INTO public.cost_allocation_rules (
        organization_id,
        name,
        expense_gl_account_id,
        debit_gl_account_id,
        target_cost_centre_id,
        basis,
        custom_percentage,
        is_active
      )
      VALUES (
        p_organization_id,
        rule.name,
        (acc->>rule.expense_code)::uuid,
        (acc->>rule.debit_code)::uuid,
        NULL,
        rule.basis,
        NULL,
        true
      )
      RETURNING id INTO rule_id;
    END IF;

    INSERT INTO public.cost_allocation_rule_centres (
      organization_id,
      rule_id,
      cost_centre_id,
      is_enabled
    )
    SELECT p_organization_id, rule_id, value::uuid, true
    FROM jsonb_each_text(centre_ids)
    ON CONFLICT (organization_id, rule_id, cost_centre_id) DO NOTHING;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.ensure_organization_standard_setup(uuid, text) IS
  'Idempotently seeds a standard chart of accounts, journal account settings, and editable cost allocation defaults for an organization business type.';

GRANT EXECUTE ON FUNCTION public.ensure_organization_standard_setup(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_organization_standard_setup(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.ensure_organization_standard_setup_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.ensure_organization_standard_setup(NEW.id, NEW.business_type);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_organizations_standard_setup ON public.organizations;
CREATE TRIGGER trg_organizations_standard_setup
AFTER INSERT OR UPDATE OF business_type ON public.organizations
FOR EACH ROW
EXECUTE FUNCTION public.ensure_organization_standard_setup_trigger();

DO $$
DECLARE
  org record;
BEGIN
  FOR org IN SELECT id, business_type FROM public.organizations LOOP
    PERFORM public.ensure_organization_standard_setup(org.id, org.business_type);
  END LOOP;
END $$;
