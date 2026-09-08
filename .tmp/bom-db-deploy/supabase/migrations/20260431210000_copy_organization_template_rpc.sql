-- Platform superuser: duplicate an organization with the same feature flags and subscription shape,
-- copy chart of accounts + journal_gl_settings + organization_role_types + payroll_org_settings (no transactions, staff, customers, etc.).

CREATE OR REPLACE FUNCTION public.copy_organization_template(
  p_source_organization_id uuid,
  p_new_name text,
  p_new_slug text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_org_id uuid := gen_random_uuid();
  gl_map jsonb := '{}'::jsonb;
  r record;
  j journal_gl_settings%ROWTYPE;
  sub record;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_source_organization_id IS NULL OR trim(p_new_name) = '' OR trim(p_new_slug) = '' THEN
    RAISE EXCEPTION 'source organization, name, and slug are required';
  END IF;

  IF EXISTS (SELECT 1 FROM public.organizations WHERE lower(trim(slug)) = lower(trim(p_new_slug)) AND id <> p_source_organization_id) THEN
    RAISE EXCEPTION 'slug already in use';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_source_organization_id) THEN
    RAISE EXCEPTION 'Source organization not found';
  END IF;

  INSERT INTO public.organizations (
    id,
    name,
    slug,
    business_type,
    enable_front_desk,
    enable_billing,
    enable_pos,
    enable_inventory,
    enable_purchases,
    enable_accounting,
    enable_reports,
    enable_admin,
    address,
    enable_fixed_assets,
    school_enable_reports,
    school_enable_fixed_deposit,
    school_enable_accounting,
    school_enable_inventory,
    school_enable_purchases,
    created_at,
    updated_at
  )
  SELECT
    v_new_org_id,
    trim(p_new_name),
    trim(p_new_slug),
    business_type,
    enable_front_desk,
    enable_billing,
    enable_pos,
    enable_inventory,
    enable_purchases,
    enable_accounting,
    enable_reports,
    enable_admin,
    address,
    enable_fixed_assets,
    school_enable_reports,
    school_enable_fixed_deposit,
    school_enable_accounting,
    school_enable_inventory,
    school_enable_purchases,
    now(),
    now()
  FROM public.organizations
  WHERE id = p_source_organization_id;

  SELECT *
  INTO sub
  FROM public.organization_subscriptions
  WHERE organization_id = p_source_organization_id
  ORDER BY created_at DESC NULLS LAST
  LIMIT 1;

  IF FOUND THEN
    INSERT INTO public.organization_subscriptions (
      organization_id,
      plan_id,
      status,
      period_start,
      period_end,
      created_at,
      updated_at
    )
    VALUES (
      v_new_org_id,
      sub.plan_id,
      sub.status,
      sub.period_start,
      sub.period_end,
      now(),
      now()
    );
  END IF;

  FOR r IN
    SELECT id, gen_random_uuid() AS new_id
    FROM public.gl_accounts
    WHERE organization_id = p_source_organization_id
  LOOP
    gl_map := gl_map || jsonb_build_object(r.id::text, to_jsonb(r.new_id));
  END LOOP;

  INSERT INTO public.gl_accounts (
    id,
    organization_id,
    account_code,
    account_name,
    account_type,
    category,
    parent_id,
    is_active,
    created_at
  )
  SELECT
    (gl_map->>ga.id::text)::uuid,
    v_new_org_id,
    ga.account_code,
    ga.account_name,
    ga.account_type,
    ga.category,
    CASE
      WHEN ga.parent_id IS NULL THEN NULL
      ELSE (gl_map->>ga.parent_id::text)::uuid
    END,
    ga.is_active,
    ga.created_at
  FROM public.gl_accounts ga
  WHERE ga.organization_id = p_source_organization_id;

  SELECT * INTO j FROM public.journal_gl_settings WHERE organization_id = p_source_organization_id;
  IF FOUND THEN
    INSERT INTO public.journal_gl_settings (
      organization_id,
      revenue_gl_account_id,
      cash_gl_account_id,
      receivable_gl_account_id,
      expense_gl_account_id,
      payable_gl_account_id,
      pos_bank_gl_account_id,
      pos_cogs_bar_gl_account_id,
      pos_inventory_bar_gl_account_id,
      pos_cogs_kitchen_gl_account_id,
      pos_inventory_kitchen_gl_account_id,
      pos_cogs_room_gl_account_id,
      pos_inventory_room_gl_account_id,
      pos_mtn_mobile_money_gl_account_id,
      pos_airtel_money_gl_account_id,
      vat_gl_account_id,
      default_vat_percent,
      purchases_inventory_gl_account_id,
      fixed_asset_cost_gl_account_id,
      accumulated_depreciation_gl_account_id,
      depreciation_expense_gl_account_id,
      revaluation_reserve_gl_account_id,
      impairment_loss_gl_account_id,
      gain_on_disposal_gl_account_id,
      loss_on_disposal_gl_account_id,
      pos_revenue_bar_gl_account_id,
      pos_revenue_kitchen_gl_account_id,
      pos_revenue_room_gl_account_id,
      teller_allow_per_transaction_counterparty_gl,
      teller_default_counterparty_gl_account_id,
      updated_at
    )
    VALUES (
      v_new_org_id,
      CASE WHEN j.revenue_gl_account_id IS NULL THEN NULL ELSE (gl_map->>j.revenue_gl_account_id::text)::uuid END,
      CASE WHEN j.cash_gl_account_id IS NULL THEN NULL ELSE (gl_map->>j.cash_gl_account_id::text)::uuid END,
      CASE WHEN j.receivable_gl_account_id IS NULL THEN NULL ELSE (gl_map->>j.receivable_gl_account_id::text)::uuid END,
      CASE WHEN j.expense_gl_account_id IS NULL THEN NULL ELSE (gl_map->>j.expense_gl_account_id::text)::uuid END,
      CASE WHEN j.payable_gl_account_id IS NULL THEN NULL ELSE (gl_map->>j.payable_gl_account_id::text)::uuid END,
      CASE WHEN j.pos_bank_gl_account_id IS NULL THEN NULL ELSE (gl_map->>j.pos_bank_gl_account_id::text)::uuid END,
      CASE WHEN j.pos_cogs_bar_gl_account_id IS NULL THEN NULL ELSE (gl_map->>j.pos_cogs_bar_gl_account_id::text)::uuid END,
      CASE WHEN j.pos_inventory_bar_gl_account_id IS NULL THEN NULL ELSE (gl_map->>j.pos_inventory_bar_gl_account_id::text)::uuid END,
      CASE WHEN j.pos_cogs_kitchen_gl_account_id IS NULL THEN NULL ELSE (gl_map->>j.pos_cogs_kitchen_gl_account_id::text)::uuid END,
      CASE WHEN j.pos_inventory_kitchen_gl_account_id IS NULL THEN NULL ELSE (gl_map->>j.pos_inventory_kitchen_gl_account_id::text)::uuid END,
      CASE WHEN j.pos_cogs_room_gl_account_id IS NULL THEN NULL ELSE (gl_map->>j.pos_cogs_room_gl_account_id::text)::uuid END,
      CASE WHEN j.pos_inventory_room_gl_account_id IS NULL THEN NULL ELSE (gl_map->>j.pos_inventory_room_gl_account_id::text)::uuid END,
      CASE WHEN j.pos_mtn_mobile_money_gl_account_id IS NULL THEN NULL ELSE (gl_map->>j.pos_mtn_mobile_money_gl_account_id::text)::uuid END,
      CASE WHEN j.pos_airtel_money_gl_account_id IS NULL THEN NULL ELSE (gl_map->>j.pos_airtel_money_gl_account_id::text)::uuid END,
      CASE WHEN j.vat_gl_account_id IS NULL THEN NULL ELSE (gl_map->>j.vat_gl_account_id::text)::uuid END,
      j.default_vat_percent,
      CASE WHEN j.purchases_inventory_gl_account_id IS NULL THEN NULL ELSE (gl_map->>j.purchases_inventory_gl_account_id::text)::uuid END,
      CASE WHEN j.fixed_asset_cost_gl_account_id IS NULL THEN NULL ELSE (gl_map->>j.fixed_asset_cost_gl_account_id::text)::uuid END,
      CASE WHEN j.accumulated_depreciation_gl_account_id IS NULL THEN NULL ELSE (gl_map->>j.accumulated_depreciation_gl_account_id::text)::uuid END,
      CASE WHEN j.depreciation_expense_gl_account_id IS NULL THEN NULL ELSE (gl_map->>j.depreciation_expense_gl_account_id::text)::uuid END,
      CASE WHEN j.revaluation_reserve_gl_account_id IS NULL THEN NULL ELSE (gl_map->>j.revaluation_reserve_gl_account_id::text)::uuid END,
      CASE WHEN j.impairment_loss_gl_account_id IS NULL THEN NULL ELSE (gl_map->>j.impairment_loss_gl_account_id::text)::uuid END,
      CASE WHEN j.gain_on_disposal_gl_account_id IS NULL THEN NULL ELSE (gl_map->>j.gain_on_disposal_gl_account_id::text)::uuid END,
      CASE WHEN j.loss_on_disposal_gl_account_id IS NULL THEN NULL ELSE (gl_map->>j.loss_on_disposal_gl_account_id::text)::uuid END,
      CASE WHEN j.pos_revenue_bar_gl_account_id IS NULL THEN NULL ELSE (gl_map->>j.pos_revenue_bar_gl_account_id::text)::uuid END,
      CASE WHEN j.pos_revenue_kitchen_gl_account_id IS NULL THEN NULL ELSE (gl_map->>j.pos_revenue_kitchen_gl_account_id::text)::uuid END,
      CASE WHEN j.pos_revenue_room_gl_account_id IS NULL THEN NULL ELSE (gl_map->>j.pos_revenue_room_gl_account_id::text)::uuid END,
      j.teller_allow_per_transaction_counterparty_gl,
      CASE WHEN j.teller_default_counterparty_gl_account_id IS NULL THEN NULL ELSE (gl_map->>j.teller_default_counterparty_gl_account_id::text)::uuid END,
      now()
    );
  END IF;

  INSERT INTO public.organization_role_types (organization_id, role_key, display_name, sort_order)
  SELECT
    v_new_org_id,
    role_key,
    display_name,
    sort_order
  FROM public.organization_role_types
  WHERE organization_id = p_source_organization_id;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'payroll_org_settings'
  ) THEN
    INSERT INTO public.payroll_org_settings (
      organization_id,
      paye_personal_relief_monthly,
      paye_taxable_band_1_limit,
      paye_rate_band_1_pct,
      paye_rate_above_band_1_pct,
      nssf_employee_rate_pct,
      nssf_employer_rate_pct,
      nssf_gross_ceiling,
      salary_expense_gl_account_id,
      paye_payable_gl_account_id,
      nssf_payable_gl_account_id,
      salaries_payable_gl_account_id,
      staff_loan_receivable_gl_account_id,
      payroll_working_days_per_month,
      updated_at
    )
    SELECT
      v_new_org_id,
      paye_personal_relief_monthly,
      paye_taxable_band_1_limit,
      paye_rate_band_1_pct,
      paye_rate_above_band_1_pct,
      nssf_employee_rate_pct,
      nssf_employer_rate_pct,
      nssf_gross_ceiling,
      CASE WHEN salary_expense_gl_account_id IS NULL THEN NULL ELSE (gl_map->>salary_expense_gl_account_id::text)::uuid END,
      CASE WHEN paye_payable_gl_account_id IS NULL THEN NULL ELSE (gl_map->>paye_payable_gl_account_id::text)::uuid END,
      CASE WHEN nssf_payable_gl_account_id IS NULL THEN NULL ELSE (gl_map->>nssf_payable_gl_account_id::text)::uuid END,
      CASE WHEN salaries_payable_gl_account_id IS NULL THEN NULL ELSE (gl_map->>salaries_payable_gl_account_id::text)::uuid END,
      CASE WHEN staff_loan_receivable_gl_account_id IS NULL THEN NULL ELSE (gl_map->>staff_loan_receivable_gl_account_id::text)::uuid END,
      payroll_working_days_per_month,
      now()
    FROM public.payroll_org_settings
    WHERE organization_id = p_source_organization_id;
  END IF;

  RETURN v_new_org_id;
END;
$$;

COMMENT ON FUNCTION public.copy_organization_template(uuid, text, text) IS
  'Platform admin only: new org with same flags + latest subscription row + GL chart + journal_gl_settings + role types + payroll_org_settings. No operational data.';

GRANT EXECUTE ON FUNCTION public.copy_organization_template(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.copy_organization_template(uuid, text, text) TO service_role;
