ALTER TABLE public.journal_gl_settings
  ADD COLUMN IF NOT EXISTS stock_adjustment_inventory_variance_expense_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stock_adjustment_inventory_variance_gain_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stock_adjustment_damaged_goods_expense_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stock_adjustment_inventory_shrinkage_expense_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stock_adjustment_expired_stock_expense_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stock_adjustment_internal_consumption_expense_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stock_adjustment_work_in_progress_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stock_adjustment_raw_materials_inventory_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stock_adjustment_finished_goods_inventory_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.journal_gl_settings.stock_adjustment_inventory_variance_expense_gl_account_id IS
  'Stock adjustment debit account for physical-count shortages.';
COMMENT ON COLUMN public.journal_gl_settings.stock_adjustment_inventory_variance_gain_gl_account_id IS
  'Stock adjustment credit account for physical-count surplus.';
COMMENT ON COLUMN public.journal_gl_settings.stock_adjustment_damaged_goods_expense_gl_account_id IS
  'Stock adjustment debit account for damaged stock.';
COMMENT ON COLUMN public.journal_gl_settings.stock_adjustment_inventory_shrinkage_expense_gl_account_id IS
  'Stock adjustment debit account for theft or shrinkage.';
COMMENT ON COLUMN public.journal_gl_settings.stock_adjustment_expired_stock_expense_gl_account_id IS
  'Stock adjustment debit account for expired stock.';
COMMENT ON COLUMN public.journal_gl_settings.stock_adjustment_internal_consumption_expense_gl_account_id IS
  'Stock adjustment internal-consumption expense fallback when department expense is blank.';
COMMENT ON COLUMN public.journal_gl_settings.stock_adjustment_work_in_progress_gl_account_id IS
  'Stock adjustment work-in-progress account for production issue/receipt movements.';
COMMENT ON COLUMN public.journal_gl_settings.stock_adjustment_raw_materials_inventory_gl_account_id IS
  'Stock adjustment raw-materials inventory account for production issue credits.';
COMMENT ON COLUMN public.journal_gl_settings.stock_adjustment_finished_goods_inventory_gl_account_id IS
  'Stock adjustment finished-goods inventory account for production receipt debits.';

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
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization_id is required';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF public.auth_organization_id() IS DISTINCT FROM p_organization_id AND NOT public.is_platform_admin() THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
  END IF;

  FOR r IN
    SELECT * FROM (
      VALUES
        ('1170', 'Work in Progress', 'asset', 'inventory'),
        ('1171', 'Raw Materials Inventory', 'asset', 'inventory'),
        ('1172', 'Finished Goods Inventory', 'asset', 'inventory'),
        ('4210', 'Inventory Variance Gain', 'income', 'other'),
        ('5010', 'Inventory Variance Expense', 'expense', 'expense'),
        ('5020', 'Damaged Goods Expense', 'expense', 'expense'),
        ('5030', 'Inventory Shrinkage Expense', 'expense', 'expense'),
        ('5040', 'Expired Stock Expense', 'expense', 'expense'),
        ('5050', 'Internal Consumption Expense', 'expense', 'expense')
    ) AS v(account_code, account_name, account_type, category)
  LOOP
    SELECT ga.id INTO v_id
    FROM public.gl_accounts ga
    WHERE ga.organization_id = p_organization_id
      AND ga.account_code = r.account_code
    LIMIT 1;

    IF v_id IS NULL THEN
      INSERT INTO public.gl_accounts (
        id, account_code, account_name, account_type, category, organization_id, is_active
      ) VALUES (
        gen_random_uuid(), r.account_code, r.account_name, r.account_type, r.category, p_organization_id, true
      )
      RETURNING id INTO v_id;
      inserted := inserted + 1;
    ELSE
      UPDATE public.gl_accounts
      SET is_active = true
      WHERE id = v_id;
    END IF;
  END LOOP;

  SELECT id INTO v_wip FROM public.gl_accounts WHERE organization_id = p_organization_id AND account_code = '1170' LIMIT 1;
  SELECT id INTO v_raw_materials FROM public.gl_accounts WHERE organization_id = p_organization_id AND account_code = '1171' LIMIT 1;
  SELECT id INTO v_finished_goods FROM public.gl_accounts WHERE organization_id = p_organization_id AND account_code = '1172' LIMIT 1;
  SELECT id INTO v_variance_gain FROM public.gl_accounts WHERE organization_id = p_organization_id AND account_code = '4210' LIMIT 1;
  SELECT id INTO v_variance_expense FROM public.gl_accounts WHERE organization_id = p_organization_id AND account_code = '5010' LIMIT 1;
  SELECT id INTO v_damaged_expense FROM public.gl_accounts WHERE organization_id = p_organization_id AND account_code = '5020' LIMIT 1;
  SELECT id INTO v_shrinkage_expense FROM public.gl_accounts WHERE organization_id = p_organization_id AND account_code = '5030' LIMIT 1;
  SELECT id INTO v_expired_expense FROM public.gl_accounts WHERE organization_id = p_organization_id AND account_code = '5040' LIMIT 1;
  SELECT id INTO v_internal_consumption FROM public.gl_accounts WHERE organization_id = p_organization_id AND account_code = '5050' LIMIT 1;

  INSERT INTO public.journal_gl_settings (organization_id)
  VALUES (p_organization_id)
  ON CONFLICT (organization_id) DO NOTHING;

  UPDATE public.journal_gl_settings
  SET
    stock_adjustment_inventory_variance_expense_gl_account_id =
      COALESCE(stock_adjustment_inventory_variance_expense_gl_account_id, v_variance_expense),
    stock_adjustment_inventory_variance_gain_gl_account_id =
      COALESCE(stock_adjustment_inventory_variance_gain_gl_account_id, v_variance_gain),
    stock_adjustment_damaged_goods_expense_gl_account_id =
      COALESCE(stock_adjustment_damaged_goods_expense_gl_account_id, v_damaged_expense),
    stock_adjustment_inventory_shrinkage_expense_gl_account_id =
      COALESCE(stock_adjustment_inventory_shrinkage_expense_gl_account_id, v_shrinkage_expense),
    stock_adjustment_expired_stock_expense_gl_account_id =
      COALESCE(stock_adjustment_expired_stock_expense_gl_account_id, v_expired_expense),
    stock_adjustment_internal_consumption_expense_gl_account_id =
      COALESCE(stock_adjustment_internal_consumption_expense_gl_account_id, v_internal_consumption),
    stock_adjustment_work_in_progress_gl_account_id =
      COALESCE(stock_adjustment_work_in_progress_gl_account_id, v_wip),
    stock_adjustment_raw_materials_inventory_gl_account_id =
      COALESCE(stock_adjustment_raw_materials_inventory_gl_account_id, v_raw_materials),
    stock_adjustment_finished_goods_inventory_gl_account_id =
      COALESCE(stock_adjustment_finished_goods_inventory_gl_account_id, v_finished_goods),
    updated_at = now()
  WHERE organization_id = p_organization_id;

  RETURN inserted;
END;
$$;

COMMENT ON FUNCTION public.ensure_stock_adjustment_gl_accounts(uuid) IS
  'Adds standard stock-adjustment GL accounts to one organization chart and fills empty journal_gl_settings mappings.';

GRANT EXECUTE ON FUNCTION public.ensure_stock_adjustment_gl_accounts(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_stock_adjustment_gl_accounts(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
