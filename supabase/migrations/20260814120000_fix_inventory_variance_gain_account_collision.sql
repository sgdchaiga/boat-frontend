-- 4210 is used by hotel charts for Conference/Hall Hire. Stock-surplus
-- postings must use a semantically correct, dedicated income account instead.

CREATE OR REPLACE FUNCTION public.ensure_inventory_variance_gain_account(p_organization_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_code text;
  v_parent_id uuid;
BEGIN
  SELECT id INTO v_id
  FROM public.gl_accounts
  WHERE organization_id = p_organization_id
    AND lower(trim(account_name)) = 'inventory variance gain'
    AND account_type = 'income'
  ORDER BY is_active DESC, account_code
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.gl_accounts SET is_active = true WHERE id = v_id;
    RETURN v_id;
  END IF;

  SELECT candidate INTO v_code
  FROM unnest(ARRAY['4290','4291','4292','4293','4294','4295','4296','4297','4298','4299']) candidate
  WHERE NOT EXISTS (
    SELECT 1 FROM public.gl_accounts
    WHERE organization_id = p_organization_id AND account_code = candidate
  )
  LIMIT 1;

  IF v_code IS NULL THEN
    RAISE EXCEPTION 'No free Inventory Variance Gain account code is available in range 4290-4299';
  END IF;

  SELECT id INTO v_parent_id
  FROM public.gl_accounts
  WHERE organization_id = p_organization_id AND account_code = '4200'
  LIMIT 1;

  INSERT INTO public.gl_accounts (
    id, organization_id, account_code, account_name, account_type, category, parent_id, is_active
  ) VALUES (
    gen_random_uuid(), p_organization_id, v_code, 'Inventory Variance Gain', 'income', 'other', v_parent_id, true
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_inventory_variance_gain_account(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_inventory_variance_gain_account(uuid) TO service_role;

DO $$
DECLARE
  r record;
  v_gain_id uuid;
BEGIN
  FOR r IN
    SELECT s.organization_id
    FROM public.journal_gl_settings s
    JOIN public.gl_accounts ga
      ON ga.id = s.stock_adjustment_inventory_variance_gain_gl_account_id
    WHERE lower(trim(ga.account_name)) <> 'inventory variance gain'
       OR ga.account_type <> 'income'
  LOOP
    v_gain_id := public.ensure_inventory_variance_gain_account(r.organization_id);
    UPDATE public.journal_gl_settings
    SET stock_adjustment_inventory_variance_gain_gl_account_id = v_gain_id,
        updated_at = now()
    WHERE organization_id = r.organization_id;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_stock_adjustment_gl_accounts(p_organization_id uuid DEFAULT public.auth_organization_id())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted integer := 0;
  r record;
  v_id uuid;
  v_variance_expense uuid;
  v_variance_gain uuid;
  v_damaged_expense uuid;
  v_shrinkage_expense uuid;
  v_expired_expense uuid;
  v_internal_consumption uuid;
  v_wip uuid;
  v_raw_materials uuid;
  v_finished_goods uuid;
BEGIN
  IF p_organization_id IS NULL THEN RAISE EXCEPTION 'organization_id is required'; END IF;
  IF auth.uid() IS NOT NULL
     AND public.auth_organization_id() IS DISTINCT FROM p_organization_id
     AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  FOR r IN SELECT * FROM (VALUES
    ('1170', 'Work in Progress', 'asset', 'inventory'),
    ('1171', 'Raw Materials Inventory', 'asset', 'inventory'),
    ('1172', 'Finished Goods Inventory', 'asset', 'inventory'),
    ('5010', 'Inventory Variance Expense', 'expense', 'expense'),
    ('5020', 'Damaged Goods Expense', 'expense', 'expense'),
    ('5030', 'Inventory Shrinkage Expense', 'expense', 'expense'),
    ('5040', 'Expired Stock Expense', 'expense', 'expense'),
    ('5050', 'Internal Consumption Expense', 'expense', 'expense')
  ) AS v(account_code, account_name, account_type, category)
  LOOP
    v_id := NULL;
    SELECT ga.id INTO v_id FROM public.gl_accounts ga
    WHERE ga.organization_id = p_organization_id AND ga.account_code = r.account_code LIMIT 1;
    IF v_id IS NULL THEN
      INSERT INTO public.gl_accounts (id, account_code, account_name, account_type, category, organization_id, is_active)
      VALUES (gen_random_uuid(), r.account_code, r.account_name, r.account_type, r.category, p_organization_id, true);
      inserted := inserted + 1;
    ELSE
      UPDATE public.gl_accounts SET is_active = true WHERE id = v_id;
    END IF;
  END LOOP;

  v_variance_gain := public.ensure_inventory_variance_gain_account(p_organization_id);
  SELECT id INTO v_wip FROM public.gl_accounts WHERE organization_id = p_organization_id AND account_code = '1170' LIMIT 1;
  SELECT id INTO v_raw_materials FROM public.gl_accounts WHERE organization_id = p_organization_id AND account_code = '1171' LIMIT 1;
  SELECT id INTO v_finished_goods FROM public.gl_accounts WHERE organization_id = p_organization_id AND account_code = '1172' LIMIT 1;
  SELECT id INTO v_variance_expense FROM public.gl_accounts WHERE organization_id = p_organization_id AND account_code = '5010' LIMIT 1;
  SELECT id INTO v_damaged_expense FROM public.gl_accounts WHERE organization_id = p_organization_id AND account_code = '5020' LIMIT 1;
  SELECT id INTO v_shrinkage_expense FROM public.gl_accounts WHERE organization_id = p_organization_id AND account_code = '5030' LIMIT 1;
  SELECT id INTO v_expired_expense FROM public.gl_accounts WHERE organization_id = p_organization_id AND account_code = '5040' LIMIT 1;
  SELECT id INTO v_internal_consumption FROM public.gl_accounts WHERE organization_id = p_organization_id AND account_code = '5050' LIMIT 1;

  INSERT INTO public.journal_gl_settings (organization_id) VALUES (p_organization_id)
  ON CONFLICT (organization_id) DO NOTHING;
  UPDATE public.journal_gl_settings SET
    stock_adjustment_inventory_variance_expense_gl_account_id = COALESCE(stock_adjustment_inventory_variance_expense_gl_account_id, v_variance_expense),
    stock_adjustment_inventory_variance_gain_gl_account_id = v_variance_gain,
    stock_adjustment_damaged_goods_expense_gl_account_id = COALESCE(stock_adjustment_damaged_goods_expense_gl_account_id, v_damaged_expense),
    stock_adjustment_inventory_shrinkage_expense_gl_account_id = COALESCE(stock_adjustment_inventory_shrinkage_expense_gl_account_id, v_shrinkage_expense),
    stock_adjustment_expired_stock_expense_gl_account_id = COALESCE(stock_adjustment_expired_stock_expense_gl_account_id, v_expired_expense),
    stock_adjustment_internal_consumption_expense_gl_account_id = COALESCE(stock_adjustment_internal_consumption_expense_gl_account_id, v_internal_consumption),
    stock_adjustment_work_in_progress_gl_account_id = COALESCE(stock_adjustment_work_in_progress_gl_account_id, v_wip),
    stock_adjustment_raw_materials_inventory_gl_account_id = COALESCE(stock_adjustment_raw_materials_inventory_gl_account_id, v_raw_materials),
    stock_adjustment_finished_goods_inventory_gl_account_id = COALESCE(stock_adjustment_finished_goods_inventory_gl_account_id, v_finished_goods),
    updated_at = now()
  WHERE organization_id = p_organization_id;
  RETURN inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_stock_adjustment_gl_accounts(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_stock_adjustment_gl_accounts(uuid) TO service_role;
