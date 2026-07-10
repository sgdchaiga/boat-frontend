-- Finished goods stock receipts should carry the manufactured batch unit cost, not only product.cost_price.

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
    SELECT round(
      (coalesce(c.material_cost, 0) + coalesce(c.labor_cost, 0) + coalesce(c.overhead_cost, 0)) /
      nullif(NEW.produced_qty, 0),
      4
    )
    INTO v_cost
    FROM public.manufacturing_costing_entries c
    WHERE c.organization_id = NEW.organization_id
      AND c.production_entry_id = NEW.id
    ORDER BY c.updated_at DESC NULLS LAST, c.created_at DESC
    LIMIT 1;

    IF v_cost IS NULL OR v_cost <= 0 THEN
      SELECT cost_price INTO v_cost
      FROM public.products
      WHERE id = NEW.product_id AND organization_id = NEW.organization_id;
    END IF;

    INSERT INTO public.product_stock_movements (
      product_id, movement_date, source_type, source_id,
      quantity_in, quantity_out, unit_cost, location, note, organization_id
    ) VALUES (
      NEW.product_id, v_movement_date, 'manufacturing_production', NEW.id,
      NEW.produced_qty, 0, coalesce(v_cost, 0), 'default',
      'Production entry ' || v_reference, NEW.organization_id
    );
  END IF;

  IF coalesce(NEW.scrap_qty, 0) > 0 THEN
    SELECT id, cost_price
    INTO v_scrap_product_id, v_scrap_cost
    FROM public.products
    WHERE organization_id = NEW.organization_id
      AND lower(trim(name)) IN ('scrap metal', 'scrap material')
    ORDER BY active DESC NULLS LAST, id
    LIMIT 1;

    IF v_scrap_product_id IS NULL THEN
      INSERT INTO public.products (
        organization_id, name, unit_of_measure, manufacturing_item_type,
        cost_price, sales_price, purchasable, saleable, track_inventory, active
      ) VALUES (
        NEW.organization_id, 'Scrap Material', 'kg', 'other',
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
      'Scrap material from production ' || v_reference, NEW.organization_id
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

DELETE FROM public.product_stock_movements m
USING public.manufacturing_production_entries e
WHERE m.organization_id = e.organization_id
  AND m.source_type = 'manufacturing_production'
  AND m.source_id = e.id
  AND e.product_id IS NOT NULL
  AND coalesce(e.produced_qty, 0) > 0;

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
)
SELECT
  e.product_id,
  coalesce(e.production_date::timestamptz, e.posted_at, now()),
  'manufacturing_production',
  e.id,
  e.produced_qty,
  0,
  coalesce(
    nullif(
      round(
        (coalesce(c.material_cost, 0) + coalesce(c.labor_cost, 0) + coalesce(c.overhead_cost, 0)) /
        nullif(e.produced_qty, 0),
        4
      ),
      0
    ),
    p.cost_price,
    0
  ),
  'default',
  'Production entry ' || coalesce(e.manual_serial_number, e.id::text),
  e.organization_id
FROM public.manufacturing_production_entries e
LEFT JOIN LATERAL (
  SELECT material_cost, labor_cost, overhead_cost
  FROM public.manufacturing_costing_entries c
  WHERE c.organization_id = e.organization_id
    AND c.production_entry_id = e.id
  ORDER BY c.updated_at DESC NULLS LAST, c.created_at DESC
  LIMIT 1
) c ON true
LEFT JOIN public.products p
  ON p.id = e.product_id
 AND p.organization_id = e.organization_id
WHERE e.product_id IS NOT NULL
  AND coalesce(e.produced_qty, 0) > 0;
