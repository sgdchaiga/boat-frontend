-- Use actual weighted stock cost for manufacturing material consumption instead of stale product.cost_price.

CREATE OR REPLACE FUNCTION public.post_manufacturing_bom_consumption()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bom public.manufacturing_boms%ROWTYPE;
  v_material jsonb;
  v_material_id uuid;
  v_qty numeric;
  v_unit_cost numeric;
  v_available numeric;
  v_material_cost numeric := 0;
  v_movement_at timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    DELETE FROM public.product_stock_movements
    WHERE organization_id = OLD.organization_id
      AND source_type = 'manufacturing_consumption'
      AND source_id = OLD.id;

    IF OLD.work_order_id IS NOT NULL THEN
      UPDATE public.manufacturing_work_orders
      SET completed_qty = greatest(0, completed_qty - coalesce(OLD.produced_qty, 0)),
          status = CASE
            WHEN greatest(0, completed_qty - coalesce(OLD.produced_qty, 0)) >= planned_qty THEN 'Completed'
            WHEN greatest(0, completed_qty - coalesce(OLD.produced_qty, 0)) > 0 THEN 'In Progress'
            ELSE 'Planned'
          END
      WHERE id = OLD.work_order_id AND organization_id = OLD.organization_id;
    END IF;
  END IF;

  IF NEW.product_id IS NULL OR coalesce(NEW.produced_qty, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  v_movement_at := coalesce(NEW.production_date::timestamptz, NEW.posted_at, now());

  SELECT *
  INTO v_bom
  FROM public.manufacturing_boms
  WHERE organization_id = NEW.organization_id
    AND product_id = NEW.product_id
    AND status IN ('Active', 'Draft')
  ORDER BY CASE WHEN status = 'Active' THEN 0 ELSE 1 END, updated_at DESC
  LIMIT 1;

  IF v_bom.id IS NULL THEN
    RAISE EXCEPTION 'No Active or Draft BOM exists for finished product %', coalesce(NEW.product_name, NEW.product_id::text);
  END IF;

  FOR v_material IN SELECT value FROM jsonb_array_elements(v_bom.materials)
  LOOP
    v_material_id := nullif(v_material->>'item_id', '')::uuid;
    v_qty := coalesce((v_material->>'qty')::numeric, 0) * NEW.produced_qty / v_bom.output_qty;
    IF v_material_id IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;

    PERFORM 1 FROM public.products
    WHERE id = v_material_id AND organization_id = NEW.organization_id
    FOR UPDATE;

    SELECT
      coalesce(sum(m.quantity_in - m.quantity_out), 0),
      coalesce(
        sum(CASE WHEN m.quantity_in > 0 AND coalesce(m.unit_cost, 0) > 0 THEN m.quantity_in * m.unit_cost ELSE 0 END)
          / nullif(sum(CASE WHEN m.quantity_in > 0 AND coalesce(m.unit_cost, 0) > 0 THEN m.quantity_in ELSE 0 END), 0),
        max(p.cost_price),
        0
      )
    INTO v_available, v_unit_cost
    FROM public.products p
    LEFT JOIN public.product_stock_movements m
      ON m.product_id = p.id
     AND m.organization_id = NEW.organization_id
     AND m.movement_date <= v_movement_at
    WHERE p.id = v_material_id AND p.organization_id = NEW.organization_id;

    IF v_available < v_qty THEN
      RAISE EXCEPTION 'Insufficient raw material stock for %: available %, required %',
        coalesce(v_material->>'item_name', v_material_id::text), v_available, v_qty;
    END IF;

    INSERT INTO public.product_stock_movements (
      product_id, movement_date, source_type, source_id,
      quantity_in, quantity_out, unit_cost, location, note, organization_id
    ) VALUES (
      v_material_id, v_movement_at,
      'manufacturing_consumption', NEW.id, 0, v_qty, v_unit_cost, 'default',
      'BOM consumption for production ' || coalesce(NEW.manual_serial_number, NEW.id::text),
      NEW.organization_id
    );
    v_material_cost := v_material_cost + (v_qty * v_unit_cost);
  END LOOP;

  UPDATE public.manufacturing_production_entries
  SET bom_id = v_bom.id, material_cost = round(v_material_cost, 2)
  WHERE id = NEW.id;

  INSERT INTO public.manufacturing_costing_entries (
    organization_id, production_entry_id, bom_id, product_id,
    period, product_name, material_cost, labor_cost, overhead_cost, generated_from_production
  ) VALUES (
    NEW.organization_id, NEW.id, v_bom.id, NEW.product_id,
    to_char(coalesce(NEW.production_date, NEW.posted_at::date), 'YYYY-MM'),
    NEW.product_name, round(v_material_cost, 2), 0, 0, true
  )
  ON CONFLICT (production_entry_id) WHERE production_entry_id IS NOT NULL
  DO UPDATE SET
    bom_id = EXCLUDED.bom_id,
    product_id = EXCLUDED.product_id,
    period = EXCLUDED.period,
    product_name = EXCLUDED.product_name,
    material_cost = EXCLUDED.material_cost,
    updated_at = now();

  IF NEW.work_order_id IS NOT NULL THEN
    UPDATE public.manufacturing_work_orders
    SET completed_qty = completed_qty + NEW.produced_qty,
        status = CASE WHEN completed_qty + NEW.produced_qty >= planned_qty THEN 'Completed' ELSE 'In Progress' END
    WHERE id = NEW.work_order_id AND organization_id = NEW.organization_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_manufacturing_bom_consumption ON public.manufacturing_production_entries;
CREATE TRIGGER trg_post_manufacturing_bom_consumption
AFTER INSERT OR UPDATE OF work_order_id, product_id, product_name, produced_qty, production_date, manual_serial_number
ON public.manufacturing_production_entries
FOR EACH ROW
EXECUTE FUNCTION public.post_manufacturing_bom_consumption();

-- Revalue existing generated production material costing without firing stock consumption triggers.
DO $$
DECLARE
  rec record;
  material jsonb;
  material_id uuid;
  qty numeric;
  unit_cost numeric;
  material_total numeric;
  movement_at timestamptz;
BEGIN
  FOR rec IN
    SELECT e.*, b.id AS resolved_bom_id, b.materials, b.output_qty
    FROM public.manufacturing_production_entries e
    JOIN LATERAL (
      SELECT *
      FROM public.manufacturing_boms b
      WHERE b.organization_id = e.organization_id
        AND b.product_id = e.product_id
        AND b.status IN ('Active', 'Draft')
      ORDER BY CASE WHEN b.status = 'Active' THEN 0 ELSE 1 END, b.updated_at DESC
      LIMIT 1
    ) b ON true
    WHERE e.product_id IS NOT NULL
      AND coalesce(e.produced_qty, 0) > 0
  LOOP
    material_total := 0;
    movement_at := coalesce(rec.production_date::timestamptz, rec.posted_at, now());

    DELETE FROM public.product_stock_movements
    WHERE organization_id = rec.organization_id
      AND source_type = 'manufacturing_consumption'
      AND source_id = rec.id;

    FOR material IN SELECT value FROM jsonb_array_elements(rec.materials)
    LOOP
      material_id := nullif(material->>'item_id', '')::uuid;
      qty := coalesce((material->>'qty')::numeric, 0) * rec.produced_qty / rec.output_qty;
      IF material_id IS NULL OR qty <= 0 THEN CONTINUE; END IF;

      SELECT coalesce(
        sum(CASE WHEN m.quantity_in > 0 AND coalesce(m.unit_cost, 0) > 0 THEN m.quantity_in * m.unit_cost ELSE 0 END)
          / nullif(sum(CASE WHEN m.quantity_in > 0 AND coalesce(m.unit_cost, 0) > 0 THEN m.quantity_in ELSE 0 END), 0),
        max(p.cost_price),
        0
      )
      INTO unit_cost
      FROM public.products p
      LEFT JOIN public.product_stock_movements m
        ON m.product_id = p.id
       AND m.organization_id = rec.organization_id
       AND m.movement_date <= movement_at
      WHERE p.id = material_id AND p.organization_id = rec.organization_id;

      INSERT INTO public.product_stock_movements (
        product_id, movement_date, source_type, source_id,
        quantity_in, quantity_out, unit_cost, location, note, organization_id
      ) VALUES (
        material_id, movement_at,
        'manufacturing_consumption', rec.id, 0, qty, unit_cost, 'default',
        'BOM consumption for production ' || coalesce(rec.manual_serial_number, rec.id::text),
        rec.organization_id
      );

      material_total := material_total + (qty * unit_cost);
    END LOOP;

    UPDATE public.manufacturing_production_entries
    SET bom_id = rec.resolved_bom_id,
        material_cost = round(material_total, 2)
    WHERE id = rec.id;

    UPDATE public.manufacturing_costing_entries
    SET bom_id = rec.resolved_bom_id,
        material_cost = round(material_total, 2),
        updated_at = now()
    WHERE production_entry_id = rec.id
      AND generated_from_production = true;
  END LOOP;
END $$;

-- Refresh finished-goods receipts after the material-cost revaluation above.
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
