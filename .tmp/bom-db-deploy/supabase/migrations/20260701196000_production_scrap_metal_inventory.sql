-- Production scrap automatically increases the organization's Scrap Metal inventory.

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_stock_movements_production_scrap
  ON public.product_stock_movements (organization_id, source_type, source_id, product_id)
  WHERE source_type = 'manufacturing_scrap';

CREATE OR REPLACE FUNCTION public.post_manufacturing_production_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cost numeric;
  v_scrap_product_id uuid;
  v_scrap_cost numeric;
  v_movement_date timestamptz;
  v_reference text;
BEGIN
  v_movement_date := coalesce(NEW.production_date::timestamptz, NEW.posted_at, now());
  v_reference := coalesce(NEW.manual_serial_number, NEW.id::text);

  DELETE FROM public.product_stock_movements
  WHERE organization_id = NEW.organization_id
    AND source_type IN ('manufacturing_production', 'manufacturing_scrap')
    AND source_id = NEW.id;

  IF NEW.product_id IS NOT NULL AND coalesce(NEW.produced_qty, 0) > 0 THEN
    SELECT cost_price INTO v_cost
    FROM public.products
    WHERE id = NEW.product_id AND organization_id = NEW.organization_id;

    INSERT INTO public.product_stock_movements (
      product_id, movement_date, source_type, source_id,
      quantity_in, quantity_out, unit_cost, location, note, organization_id
    ) VALUES (
      NEW.product_id, v_movement_date, 'manufacturing_production', NEW.id,
      NEW.produced_qty, 0, v_cost, 'default',
      'Production entry ' || v_reference, NEW.organization_id
    );
  END IF;

  IF coalesce(NEW.scrap_qty, 0) > 0 THEN
    SELECT id, cost_price
    INTO v_scrap_product_id, v_scrap_cost
    FROM public.products
    WHERE organization_id = NEW.organization_id
      AND lower(trim(name)) = 'scrap metal'
    ORDER BY active DESC NULLS LAST, id
    LIMIT 1;

    IF v_scrap_product_id IS NULL THEN
      INSERT INTO public.products (
        organization_id, name, unit_of_measure, manufacturing_item_type,
        cost_price, sales_price, purchasable, saleable, track_inventory, active
      ) VALUES (
        NEW.organization_id, 'Scrap Metal', 'kg', 'other',
        0, 0, false, true, true, true
      )
      RETURNING id, cost_price INTO v_scrap_product_id, v_scrap_cost;
    END IF;

    INSERT INTO public.product_stock_movements (
      product_id, movement_date, source_type, source_id,
      quantity_in, quantity_out, unit_cost, location, note, organization_id
    ) VALUES (
      v_scrap_product_id, v_movement_date, 'manufacturing_scrap', NEW.id,
      NEW.scrap_qty, 0, coalesce(v_scrap_cost, 0), 'default',
      'Scrap metal from production ' || v_reference, NEW.organization_id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_manufacturing_production_stock ON public.manufacturing_production_entries;
CREATE TRIGGER trg_post_manufacturing_production_stock
AFTER INSERT OR UPDATE OF product_id, produced_qty, scrap_qty, production_date, manual_serial_number
ON public.manufacturing_production_entries
FOR EACH ROW
EXECUTE FUNCTION public.post_manufacturing_production_stock();

-- Populate Scrap Metal inventory for production entries recorded before this migration.
UPDATE public.manufacturing_production_entries
SET scrap_qty = scrap_qty
WHERE scrap_qty > 0;

COMMENT ON COLUMN public.manufacturing_production_entries.scrap_qty IS
  'Scrap metal quantity added automatically to the organization Scrap Metal inventory item.';
