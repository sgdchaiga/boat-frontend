-- Production entries: user-facing serial/date, direct finished-product link, and stock-in posting.

ALTER TABLE public.manufacturing_production_entries
  ADD COLUMN IF NOT EXISTS manual_serial_number text,
  ADD COLUMN IF NOT EXISTS production_date date,
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id) ON DELETE SET NULL;

UPDATE public.manufacturing_production_entries
SET production_date = posted_at::date
WHERE production_date IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_manufacturing_production_manual_serial
  ON public.manufacturing_production_entries (organization_id, lower(manual_serial_number))
  WHERE manual_serial_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_manufacturing_production_product
  ON public.manufacturing_production_entries (organization_id, product_id, production_date DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_stock_movements_production_entry
  ON public.product_stock_movements (organization_id, source_type, source_id, product_id)
  WHERE source_type = 'manufacturing_production';

CREATE OR REPLACE FUNCTION public.post_manufacturing_production_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cost numeric;
BEGIN
  DELETE FROM public.product_stock_movements
  WHERE organization_id = NEW.organization_id
    AND source_type = 'manufacturing_production'
    AND source_id = NEW.id;

  IF NEW.product_id IS NULL OR coalesce(NEW.produced_qty, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT cost_price INTO v_cost
  FROM public.products
  WHERE id = NEW.product_id AND organization_id = NEW.organization_id;

  INSERT INTO public.product_stock_movements (
    product_id,
    movement_date,
    source_type,
    source_id,
    quantity_in,
    quantity_out,
    unit_cost,
    location,
    note,
    organization_id
  ) VALUES (
    NEW.product_id,
    coalesce(NEW.production_date::timestamptz, NEW.posted_at, now()),
    'manufacturing_production',
    NEW.id,
    NEW.produced_qty,
    0,
    v_cost,
    'default',
    'Production entry ' || coalesce(NEW.manual_serial_number, NEW.id::text),
    NEW.organization_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_manufacturing_production_stock ON public.manufacturing_production_entries;
CREATE TRIGGER trg_post_manufacturing_production_stock
AFTER INSERT OR UPDATE OF product_id, produced_qty, production_date, manual_serial_number
ON public.manufacturing_production_entries
FOR EACH ROW
EXECUTE FUNCTION public.post_manufacturing_production_stock();

COMMENT ON COLUMN public.manufacturing_production_entries.manual_serial_number IS 'User-entered production entry reference shown instead of the internal UUID.';
COMMENT ON COLUMN public.manufacturing_production_entries.production_date IS 'Business date on which finished goods were produced.';
COMMENT ON COLUMN public.manufacturing_production_entries.product_id IS 'Finished product added to stock by this production entry.';
