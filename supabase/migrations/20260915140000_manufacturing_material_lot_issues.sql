-- Optional lot selection on each BOM material. Existing untracked production remains valid.
ALTER TABLE public.manufacturing_production_entries
  ADD COLUMN IF NOT EXISTS material_lots jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.stamp_manufacturing_material_lot()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_lot_text text;
  v_lot public.product_lots%ROWTYPE;
  v_available numeric;
BEGIN
  IF NEW.source_type <> 'manufacturing_consumption' OR NEW.quantity_out <= 0 THEN RETURN NEW; END IF;
  SELECT material_lots->>NEW.product_id::text INTO v_lot_text
  FROM public.manufacturing_production_entries
  WHERE id = NEW.source_id AND organization_id = NEW.organization_id AND manufacturing_version = 2;
  IF nullif(v_lot_text, '') IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_lot FROM public.product_lots WHERE id = v_lot_text::uuid FOR UPDATE;
  IF v_lot.id IS NULL OR v_lot.organization_id <> NEW.organization_id OR v_lot.product_id <> NEW.product_id THEN
    RAISE EXCEPTION 'Selected raw-material lot does not match the material';
  END IF;
  IF v_lot.status <> 'available' OR (v_lot.expires_on IS NOT NULL AND v_lot.expires_on < NEW.movement_date::date) THEN
    RAISE EXCEPTION 'Raw-material lot % is held, rejected, or expired', v_lot.lot_number;
  END IF;
  SELECT coalesce(sum(quantity_in - quantity_out), 0) INTO v_available
  FROM public.product_stock_movements
  WHERE organization_id = NEW.organization_id AND product_id = NEW.product_id AND lot_id = v_lot.id;
  IF v_available < NEW.quantity_out THEN
    RAISE EXCEPTION 'Insufficient stock in raw-material lot %: available %, required %', v_lot.lot_number, v_available, NEW.quantity_out;
  END IF;
  NEW.lot_id := v_lot.id;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_stamp_manufacturing_material_lot
BEFORE INSERT ON public.product_stock_movements
FOR EACH ROW EXECUTE FUNCTION public.stamp_manufacturing_material_lot();

COMMENT ON COLUMN public.manufacturing_production_entries.material_lots IS
  'Map of BOM material product UUID to selected raw-material lot UUID for issue traceability.';

CREATE OR REPLACE FUNCTION public.assign_untracked_stock_to_lot(p_lot_id uuid, p_qty numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lot public.product_lots%ROWTYPE; v_untracked numeric; v_cost numeric;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN RAISE EXCEPTION 'Lot assignment quantity must be positive'; END IF;
  SELECT * INTO v_lot FROM public.product_lots WHERE id = p_lot_id FOR UPDATE;
  IF v_lot.id IS NULL THEN RAISE EXCEPTION 'Lot not found'; END IF;
  IF (public.is_platform_admin() OR public.auth_staff_org_id() = v_lot.organization_id) IS NOT TRUE THEN RAISE EXCEPTION 'Not permitted'; END IF;
  IF NOT public.manufacturing_v2_enabled(v_lot.organization_id) THEN RAISE EXCEPTION 'Manufacturing V2 is not enabled for this business'; END IF;
  IF v_lot.status <> 'available' THEN RAISE EXCEPTION 'Only available lots can receive stock'; END IF;
  PERFORM 1 FROM public.products WHERE id = v_lot.product_id AND organization_id = v_lot.organization_id FOR UPDATE;
  SELECT coalesce(sum(quantity_in - quantity_out), 0) INTO v_untracked
  FROM public.product_stock_movements
  WHERE organization_id = v_lot.organization_id AND product_id = v_lot.product_id AND lot_id IS NULL;
  IF v_untracked < p_qty THEN RAISE EXCEPTION 'Untracked stock available %, requested %', v_untracked, p_qty; END IF;
  SELECT coalesce(cost_price, 0) INTO v_cost FROM public.products WHERE id = v_lot.product_id AND organization_id = v_lot.organization_id;
  INSERT INTO public.product_stock_movements (organization_id, product_id, movement_date, source_type, source_id, lot_id, quantity_in, quantity_out, unit_cost, location, note)
  VALUES
    (v_lot.organization_id, v_lot.product_id, now(), 'lot_assignment', v_lot.id, NULL, 0, p_qty, v_cost, 'default', 'Assign untracked stock to lot ' || v_lot.lot_number),
    (v_lot.organization_id, v_lot.product_id, now(), 'lot_assignment', v_lot.id, v_lot.id, p_qty, 0, v_cost, 'default', 'Lot ' || v_lot.lot_number);
END; $$;

GRANT EXECUTE ON FUNCTION public.assign_untracked_stock_to_lot(uuid, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_stock_movement_lot()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_lot public.product_lots%ROWTYPE; v_available numeric;
BEGIN
  IF NEW.lot_id IS NOT NULL AND NOT public.manufacturing_v2_enabled(NEW.organization_id) THEN
    RAISE EXCEPTION 'Lot tracking requires Manufacturing V2';
  END IF;
  IF NEW.lot_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.product_lots
    WHERE id = NEW.lot_id AND organization_id = NEW.organization_id AND product_id = NEW.product_id
  ) THEN
    RAISE EXCEPTION 'Stock movement lot must match its organization and product';
  END IF;
  IF NEW.lot_id IS NOT NULL AND NEW.source_type = 'sale' AND NEW.quantity_out > 0 THEN
    PERFORM 1 FROM public.products WHERE id = NEW.product_id AND organization_id = NEW.organization_id FOR UPDATE;
    SELECT * INTO v_lot FROM public.product_lots WHERE id = NEW.lot_id FOR UPDATE;
    IF v_lot.status <> 'available' OR (v_lot.expires_on IS NOT NULL AND v_lot.expires_on < NEW.movement_date::date) THEN
      RAISE EXCEPTION 'Sales cannot issue a held, rejected or expired lot';
    END IF;
    SELECT coalesce(sum(quantity_in - quantity_out), 0) INTO v_available
    FROM public.product_stock_movements
    WHERE organization_id = NEW.organization_id AND product_id = NEW.product_id AND lot_id = NEW.lot_id
      AND movement_date <= NEW.movement_date AND id <> NEW.id;
    IF v_available < NEW.quantity_out THEN RAISE EXCEPTION 'Insufficient stock in the selected sales lot'; END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_stock_movement_lot
BEFORE INSERT OR UPDATE OF lot_id, product_id, organization_id, quantity_out, movement_date, source_type ON public.product_stock_movements
FOR EACH ROW EXECUTE FUNCTION public.validate_stock_movement_lot();
