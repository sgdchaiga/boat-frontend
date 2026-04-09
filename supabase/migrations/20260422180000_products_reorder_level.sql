-- Reorder point for inventory-managed products (optional).
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS reorder_level numeric;

COMMENT ON COLUMN public.products.reorder_level IS 'Target minimum on-hand quantity for reorder alerts';
