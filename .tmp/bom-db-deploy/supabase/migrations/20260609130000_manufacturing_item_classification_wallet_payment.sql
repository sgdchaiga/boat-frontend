ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS unit_of_measure text NOT NULL DEFAULT 'unit',
  ADD COLUMN IF NOT EXISTS manufacturing_item_type text;

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

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_payment_method_check;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_payment_method_check
  CHECK (
    payment_method IN (
      'cash',
      'card',
      'bank_transfer',
      'mobile_money',
      'mtn_mobile_money',
      'airtel_money',
      'wallet'
    )
  );

CREATE INDEX IF NOT EXISTS idx_products_org_manufacturing_type
  ON public.products (organization_id, manufacturing_item_type);
