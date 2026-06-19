-- Link purchase-order lines to inventory products.
-- The column is nullable so legacy free-text lines remain readable.

ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS product_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.purchase_order_items'::regclass
      AND conname = 'purchase_order_items_product_id_fkey'
  ) THEN
    ALTER TABLE public.purchase_order_items
      ADD CONSTRAINT purchase_order_items_product_id_fkey
      FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_purchase_order_items_product_id
  ON public.purchase_order_items(product_id);

COMMENT ON COLUMN public.purchase_order_items.product_id IS
  'Inventory product selected for this purchase-order line; nullable for legacy free-text lines.';
