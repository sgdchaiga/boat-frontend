-- Allocate finished-goods POS issues to eligible lots, earliest expiry first.
-- Untracked stock remains usable for existing product balances.
CREATE OR REPLACE FUNCTION public.allocate_manufactured_sale_lots()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item_type text;
  v_remaining numeric := NEW.quantity_out;
  v_untracked numeric;
  v_available numeric;
  v_take numeric;
  v_lot record;
BEGIN
  IF NOT public.manufacturing_v2_enabled(NEW.organization_id) THEN RETURN NEW; END IF;
  IF NEW.source_type IS DISTINCT FROM 'sale' OR coalesce(NEW.quantity_out, 0) <= 0 OR NEW.lot_id IS NOT NULL THEN RETURN NEW; END IF;

  SELECT manufacturing_item_type INTO v_item_type
  FROM public.products
  WHERE id = NEW.product_id AND organization_id = NEW.organization_id FOR UPDATE;
  IF coalesce(v_item_type, '') NOT IN ('finished_product', 'semi_finished_goods') THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.product_lots WHERE organization_id = NEW.organization_id AND product_id = NEW.product_id) THEN RETURN NEW; END IF;

  -- The newly inserted issue is untagged, so add it back to inspect the pre-sale balance.
  SELECT coalesce(sum(quantity_in - quantity_out), 0) + NEW.quantity_out INTO v_untracked
  FROM public.product_stock_movements
  WHERE organization_id = NEW.organization_id AND product_id = NEW.product_id AND lot_id IS NULL
    AND movement_date <= NEW.movement_date;

  FOR v_lot IN
    SELECT id, lot_number FROM public.product_lots
    WHERE organization_id = NEW.organization_id AND product_id = NEW.product_id
      AND status = 'available' AND (expires_on IS NULL OR expires_on >= NEW.movement_date::date)
    ORDER BY expires_on NULLS LAST, manufactured_on NULLS LAST, created_at, id FOR UPDATE
  LOOP
    SELECT coalesce(sum(quantity_in - quantity_out), 0) INTO v_available
    FROM public.product_stock_movements
    WHERE organization_id = NEW.organization_id AND product_id = NEW.product_id AND lot_id = v_lot.id
      AND movement_date <= NEW.movement_date;
    v_take := least(greatest(v_available, 0), v_remaining);
    IF v_take <= 0 THEN CONTINUE; END IF;
    INSERT INTO public.product_stock_movements (
      organization_id, product_id, movement_date, source_type, source_id, lot_id,
      quantity_in, quantity_out, unit_cost, location, note
    ) VALUES (
      NEW.organization_id, NEW.product_id, NEW.movement_date, 'sale', NEW.source_id, v_lot.id,
      0, v_take, NEW.unit_cost, NEW.location,
      coalesce(NEW.note, 'Sale') || ' · lot ' || v_lot.lot_number
    );
    v_remaining := v_remaining - v_take;
    IF v_remaining <= 0 THEN EXIT; END IF;
  END LOOP;

  IF v_remaining > greatest(v_untracked, 0) THEN
    RAISE EXCEPTION 'Insufficient eligible lot or untracked stock for manufactured product %: short %', NEW.product_id, v_remaining - v_untracked;
  END IF;
  -- Retain the original movement for any untracked remainder. UPDATE does not
  -- re-enter this INSERT trigger and does not need a user-editable note marker.
  IF v_remaining = 0 THEN
    DELETE FROM public.product_stock_movements WHERE id = NEW.id;
  ELSIF v_remaining < NEW.quantity_out THEN
    UPDATE public.product_stock_movements SET quantity_out = v_remaining WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_allocate_manufactured_sale_lots
AFTER INSERT ON public.product_stock_movements
FOR EACH ROW EXECUTE FUNCTION public.allocate_manufactured_sale_lots();
