-- Reserve the materials required by a production order without changing physical stock.
CREATE TABLE IF NOT EXISTS public.manufacturing_material_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  work_order_id uuid NOT NULL REFERENCES public.manufacturing_work_orders(id) ON DELETE CASCADE,
  bom_id uuid NOT NULL REFERENCES public.manufacturing_boms(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name text NOT NULL,
  unit text NOT NULL DEFAULT 'unit',
  required_qty numeric(18,3) NOT NULL CHECK (required_qty >= 0),
  reserved_qty numeric(18,3) NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  consumed_qty numeric(18,3) NOT NULL DEFAULT 0 CHECK (consumed_qty >= 0),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'reserved', 'released', 'consumed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_order_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_manufacturing_material_reservations_org_order
  ON public.manufacturing_material_reservations (organization_id, work_order_id, status);

ALTER TABLE public.manufacturing_material_reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manufacturing_material_reservations_tenant_all ON public.manufacturing_material_reservations;
CREATE POLICY manufacturing_material_reservations_tenant_all ON public.manufacturing_material_reservations
  FOR ALL TO authenticated
  USING (public.is_platform_admin() OR (public.auth_staff_org_id() IS NOT NULL AND organization_id = public.auth_staff_org_id()))
  WITH CHECK (public.is_platform_admin() OR (public.auth_staff_org_id() IS NOT NULL AND organization_id = public.auth_staff_org_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.manufacturing_material_reservations TO authenticated;

CREATE OR REPLACE FUNCTION public.seed_manufacturing_material_reservations()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_material jsonb;
BEGIN
  IF NEW.manufacturing_version <> 2 THEN RETURN NEW; END IF;
  FOR v_material IN SELECT value FROM jsonb_array_elements(coalesce(NEW.bom_snapshot->'materials', '[]'::jsonb)) LOOP
    INSERT INTO public.manufacturing_material_reservations (
      organization_id, work_order_id, bom_id, product_id, product_name, unit, required_qty
    ) VALUES (
      NEW.organization_id, NEW.id, NEW.bom_id, (v_material->>'item_id')::uuid,
      coalesce(v_material->>'item_name', 'Material'), coalesce(v_material->>'unit', 'unit'),
      round(coalesce((v_material->>'qty')::numeric, 0) * NEW.planned_qty / nullif((NEW.bom_snapshot->>'output_qty')::numeric, 0), 3)
    ) ON CONFLICT (work_order_id, product_id) DO NOTHING;
  END LOOP;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_seed_manufacturing_material_reservations ON public.manufacturing_work_orders;
CREATE TRIGGER trg_seed_manufacturing_material_reservations
AFTER INSERT ON public.manufacturing_work_orders
FOR EACH ROW EXECUTE FUNCTION public.seed_manufacturing_material_reservations();

CREATE OR REPLACE FUNCTION public.reserve_manufacturing_work_order_materials(p_work_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order public.manufacturing_work_orders%ROWTYPE; v_line record; v_on_hand numeric; v_other_reserved numeric;
BEGIN
  SELECT * INTO v_order FROM public.manufacturing_work_orders WHERE id = p_work_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'Production order not found'; END IF;
  IF (public.is_platform_admin() OR public.auth_staff_org_id() = v_order.organization_id) IS NOT TRUE THEN RAISE EXCEPTION 'Not permitted'; END IF;
  IF NOT public.manufacturing_v2_enabled(v_order.organization_id) OR v_order.manufacturing_version <> 2 THEN RAISE EXCEPTION 'This operation requires a Manufacturing V2 order'; END IF;
  IF v_order.status IN ('Cancelled', 'Completed') THEN RAISE EXCEPTION 'Materials cannot be reserved for a % order', lower(v_order.status); END IF;
  FOR v_line IN SELECT * FROM public.manufacturing_material_reservations WHERE work_order_id = p_work_order_id ORDER BY product_id FOR UPDATE LOOP
    -- Serialize reservations for the same stock across different orders.
    PERFORM 1 FROM public.products WHERE id = v_line.product_id AND organization_id = v_order.organization_id FOR UPDATE;
    SELECT coalesce(sum(quantity_in - quantity_out), 0) INTO v_on_hand FROM public.product_stock_movements WHERE organization_id = v_order.organization_id AND product_id = v_line.product_id;
    SELECT coalesce(sum(reserved_qty - consumed_qty), 0) INTO v_other_reserved FROM public.manufacturing_material_reservations WHERE organization_id = v_order.organization_id AND product_id = v_line.product_id AND work_order_id <> p_work_order_id AND status = 'reserved';
    IF v_on_hand - v_other_reserved < v_line.required_qty - v_line.consumed_qty THEN
      RAISE EXCEPTION 'Insufficient available stock for %: available %, required %', v_line.product_name, v_on_hand - v_other_reserved, v_line.required_qty - v_line.consumed_qty;
    END IF;
  END LOOP;
  UPDATE public.manufacturing_material_reservations SET reserved_qty = required_qty, status = 'reserved', updated_at = now() WHERE work_order_id = p_work_order_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.reserve_manufacturing_work_order_materials(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.release_manufacturing_work_order(p_work_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order public.manufacturing_work_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.manufacturing_work_orders WHERE id = p_work_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'Production order not found'; END IF;
  IF (public.is_platform_admin() OR public.auth_staff_org_id() = v_order.organization_id) IS NOT TRUE THEN RAISE EXCEPTION 'Not permitted'; END IF;
  IF NOT public.manufacturing_v2_enabled(v_order.organization_id) OR v_order.manufacturing_version <> 2 THEN RAISE EXCEPTION 'This operation requires a Manufacturing V2 order'; END IF;
  IF v_order.status <> 'Planned' THEN RAISE EXCEPTION 'Only planned production orders can be released'; END IF;
  IF EXISTS (SELECT 1 FROM public.manufacturing_material_reservations WHERE work_order_id = p_work_order_id AND status NOT IN ('reserved', 'consumed')) THEN
    RAISE EXCEPTION 'Reserve all production materials before releasing this order';
  END IF;
  UPDATE public.manufacturing_work_orders SET status = 'In Progress' WHERE id = p_work_order_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.release_manufacturing_work_order(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reconcile_manufacturing_material_reservations()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.manufacturing_version <> 2 THEN RETURN NEW; END IF;
  IF NEW.work_order_id IS NULL THEN RETURN NEW; END IF;
  UPDATE public.manufacturing_material_reservations r
  SET consumed_qty = least(r.required_qty, coalesce((
        SELECT sum(m.quantity_out)
        FROM public.product_stock_movements m
        JOIN public.manufacturing_production_entries e ON e.id = m.source_id
        WHERE e.work_order_id = NEW.work_order_id
          AND m.organization_id = NEW.organization_id
          AND m.source_type = 'manufacturing_consumption'
          AND m.product_id = r.product_id
      ), 0)),
      status = CASE
        WHEN coalesce((SELECT sum(m.quantity_out) FROM public.product_stock_movements m JOIN public.manufacturing_production_entries e ON e.id = m.source_id WHERE e.work_order_id = NEW.work_order_id AND m.organization_id = NEW.organization_id AND m.source_type = 'manufacturing_consumption' AND m.product_id = r.product_id), 0) >= r.required_qty THEN 'consumed'
        ELSE r.status
      END,
      updated_at = now()
  WHERE r.work_order_id = NEW.work_order_id AND r.status = 'reserved';
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_reconcile_manufacturing_material_reservations ON public.manufacturing_production_entries;
CREATE TRIGGER trg_reconcile_manufacturing_material_reservations
AFTER INSERT OR UPDATE OF work_order_id, produced_qty, product_id ON public.manufacturing_production_entries
FOR EACH ROW EXECUTE FUNCTION public.reconcile_manufacturing_material_reservations();
