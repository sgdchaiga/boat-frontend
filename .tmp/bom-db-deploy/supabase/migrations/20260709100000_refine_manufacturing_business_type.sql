-- Refine manufacturing setup to support a full inventory / WIP / finished-goods accounting model.

ALTER TABLE public.journal_gl_settings
  ADD COLUMN IF NOT EXISTS manufacturing_finished_goods_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manufacturing_wip_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manufacturing_raw_materials_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manufacturing_wages_payable_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manufacturing_overhead_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stock_adjustment_work_in_progress_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stock_adjustment_raw_materials_inventory_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stock_adjustment_finished_goods_inventory_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_manufacturing_item_type_check;

ALTER TABLE public.products
  ADD CONSTRAINT products_manufacturing_item_type_check
  CHECK (
    manufacturing_item_type IS NULL OR
    manufacturing_item_type IN (
      'raw_material',
      'packaging_material',
      'consumable',
      'semi_finished_goods',
      'finished_product',
      'service',
      'fixed_asset',
      'non_stock_item',
      'other'
    )
  );

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
SELECT
  gen_random_uuid(),
  o.id,
  v.account_code,
  v.account_name,
  v.account_type,
  v.category,
  parent.id,
  true
FROM public.organizations o
CROSS JOIN (
  VALUES
    ('1173', 'Packaging Materials Inventory', 'asset', 'inventory', '1100'),
    ('1174', 'Consumables Inventory', 'asset', 'inventory', '1100'),
    ('1175', 'Spare Parts Inventory', 'asset', 'inventory', '1100'),
    ('1176', 'Semi-Finished Goods Inventory', 'asset', 'inventory', '1100'),
    ('1250', 'Factory Buildings', 'asset', 'other', '1200'),
    ('4160', 'Product Sales', 'income', 'revenue', '4000'),
    ('4161', 'Manufacturing Service Income', 'income', 'revenue', '4000'),
    ('4162', 'Scrap Sales', 'income', 'revenue', '4000'),
    ('5131', 'COGS - Raw Material Cost', 'expense', 'cogs', '5130'),
    ('5132', 'COGS - Direct Labour', 'expense', 'cogs', '5130'),
    ('5133', 'COGS - Manufacturing Overhead', 'expense', 'cogs', '5130'),
    ('5134', 'COGS - Packaging Cost', 'expense', 'cogs', '5130'),
    ('5135', 'COGS - Freight In', 'expense', 'cogs', '5130'),
    ('5136', 'COGS - Production Variances', 'expense', 'cogs', '5130'),
    ('6810', 'Factory Electricity', 'expense', 'expense', '6000'),
    ('6811', 'Factory Water', 'expense', 'expense', '6000'),
    ('6812', 'Factory Rent', 'expense', 'expense', '6000'),
    ('6813', 'Factory Security', 'expense', 'expense', '6000'),
    ('6814', 'Factory Maintenance', 'expense', 'expense', '6000'),
    ('6815', 'Factory Fuel', 'expense', 'expense', '6000'),
    ('6816', 'Factory Cleaning', 'expense', 'expense', '6000'),
    ('6817', 'Factory Depreciation', 'expense', 'expense', '6000'),
    ('6818', 'Production Supervisor Salaries', 'expense', 'expense', '6000'),
    ('6819', 'Quality Control Costs', 'expense', 'expense', '6000')
) AS v(account_code, account_name, account_type, category, parent_code)
LEFT JOIN public.gl_accounts parent
  ON parent.organization_id = o.id
 AND parent.account_code = v.parent_code
WHERE o.business_type = 'manufacturing'
  AND NOT EXISTS (
    SELECT 1
    FROM public.gl_accounts existing
    WHERE existing.organization_id = o.id
      AND existing.account_code = v.account_code
  );

UPDATE public.journal_gl_settings s
SET
  revenue_gl_account_id = COALESCE(s.revenue_gl_account_id, product_sales.id),
  purchases_inventory_gl_account_id = COALESCE(s.purchases_inventory_gl_account_id, raw_materials.id),
  manufacturing_finished_goods_gl_account_id = COALESCE(s.manufacturing_finished_goods_gl_account_id, finished_goods.id),
  manufacturing_wip_gl_account_id = COALESCE(s.manufacturing_wip_gl_account_id, wip.id),
  manufacturing_raw_materials_gl_account_id = COALESCE(s.manufacturing_raw_materials_gl_account_id, raw_materials.id),
  manufacturing_wages_payable_gl_account_id = COALESCE(s.manufacturing_wages_payable_gl_account_id, wages_payable.id),
  manufacturing_overhead_gl_account_id = COALESCE(s.manufacturing_overhead_gl_account_id, factory_overhead.id),
  stock_adjustment_work_in_progress_gl_account_id = COALESCE(s.stock_adjustment_work_in_progress_gl_account_id, wip.id),
  stock_adjustment_raw_materials_inventory_gl_account_id = COALESCE(s.stock_adjustment_raw_materials_inventory_gl_account_id, raw_materials.id),
  stock_adjustment_finished_goods_inventory_gl_account_id = COALESCE(s.stock_adjustment_finished_goods_inventory_gl_account_id, finished_goods.id),
  updated_at = now()
FROM public.organizations o
LEFT JOIN public.gl_accounts product_sales ON product_sales.organization_id = o.id AND product_sales.account_code = '4160'
LEFT JOIN public.gl_accounts raw_materials ON raw_materials.organization_id = o.id AND raw_materials.account_code = '1171'
LEFT JOIN public.gl_accounts finished_goods ON finished_goods.organization_id = o.id AND finished_goods.account_code = '1172'
LEFT JOIN public.gl_accounts wip ON wip.organization_id = o.id AND wip.account_code = '1170'
LEFT JOIN public.gl_accounts wages_payable ON wages_payable.organization_id = o.id AND wages_payable.account_code = '2140'
LEFT JOIN public.gl_accounts factory_overhead ON factory_overhead.organization_id = o.id AND factory_overhead.account_code = '6800'
WHERE s.organization_id = o.id
  AND o.business_type = 'manufacturing';

NOTIFY pgrst, 'reload schema';
