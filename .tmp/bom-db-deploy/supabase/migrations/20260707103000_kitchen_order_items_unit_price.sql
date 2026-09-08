-- Freeze Hotel POS line prices at posting time.
-- Previously hotel POS/kitchen order totals were recomputed from products.sales_price,
-- so editing an item price changed historical posted orders and reports.

ALTER TABLE public.kitchen_order_items
  ADD COLUMN IF NOT EXISTS unit_price numeric(15,2);

UPDATE public.kitchen_order_items koi
SET unit_price = COALESCE(koi.unit_price, p.sales_price, 0)
FROM public.products p
WHERE koi.product_id = p.id
  AND koi.unit_price IS NULL;

COMMENT ON COLUMN public.kitchen_order_items.unit_price IS
  'Captured POS unit selling price at the time the order line was posted. Historical totals must use this, not products.sales_price.';
