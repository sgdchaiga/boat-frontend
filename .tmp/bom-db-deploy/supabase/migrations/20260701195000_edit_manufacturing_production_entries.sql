-- Reconcile BOM consumption, costing, and work-order progress when production entries are edited.

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

    SELECT coalesce(p.cost_price, 0), coalesce(sum(m.quantity_in - m.quantity_out), 0)
    INTO v_unit_cost, v_available
    FROM public.products p
    LEFT JOIN public.product_stock_movements m
      ON m.product_id = p.id AND m.organization_id = NEW.organization_id
    WHERE p.id = v_material_id AND p.organization_id = NEW.organization_id
    GROUP BY p.cost_price;

    IF v_available < v_qty THEN
      RAISE EXCEPTION 'Insufficient raw material stock for %: available %, required %',
        coalesce(v_material->>'item_name', v_material_id::text), v_available, v_qty;
    END IF;

    INSERT INTO public.product_stock_movements (
      product_id, movement_date, source_type, source_id,
      quantity_in, quantity_out, unit_cost, location, note, organization_id
    ) VALUES (
      v_material_id, coalesce(NEW.production_date::timestamptz, NEW.posted_at, now()),
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
