-- How POS lists items: kitchen staff pick "menu dishes" (recipes → ingredient stock);
-- bar/sauna pick retail SKUs (stock on the sold product).
ALTER TABLE public.departments
  ADD COLUMN IF NOT EXISTS pos_catalog_mode text NOT NULL DEFAULT 'product_catalog';

ALTER TABLE public.departments DROP CONSTRAINT IF EXISTS departments_pos_catalog_mode_check;
ALTER TABLE public.departments ADD CONSTRAINT departments_pos_catalog_mode_check
  CHECK (pos_catalog_mode IN ('dish_menu', 'product_catalog'));

COMMENT ON COLUMN public.departments.pos_catalog_mode IS
  'dish_menu: kitchen POS menu (attach recipes to these sellable dishes). product_catalog: bar/sauna etc. (sell product SKU directly).';

-- Sensible defaults for existing rows (admin can change in Admin → Products → Departments).
UPDATE public.departments d
SET pos_catalog_mode = 'dish_menu'
WHERE d.pos_catalog_mode = 'product_catalog'
  AND LOWER(COALESCE(d.name, '')) ~ '(kitchen|restaurant|food|dining)'
  AND LOWER(COALESCE(d.name, '')) NOT LIKE '%bar%'
  AND LOWER(COALESCE(d.name, '')) NOT LIKE '%mini%';
