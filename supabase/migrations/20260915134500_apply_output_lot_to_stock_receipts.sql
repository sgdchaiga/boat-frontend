CREATE OR REPLACE FUNCTION public.apply_manufacturing_output_lot_to_stock_receipts()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.manufacturing_version <> 2 THEN RETURN NEW; END IF;
  IF NEW.output_lot_id IS NOT NULL THEN
    UPDATE public.product_stock_movements
    SET lot_id = NEW.output_lot_id
    WHERE organization_id = NEW.organization_id
      AND source_id = NEW.id
      AND product_id = NEW.product_id
      AND quantity_in > 0;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_apply_manufacturing_output_lot_to_stock_receipts
AFTER INSERT OR UPDATE OF output_lot_id ON public.manufacturing_production_entries
FOR EACH ROW EXECUTE FUNCTION public.apply_manufacturing_output_lot_to_stock_receipts();

-- The stock receipt can be inserted after the production-entry trigger has fired.
-- Stamp the lot when that receipt is created as well.
CREATE OR REPLACE FUNCTION public.stamp_manufacturing_receipt_lot()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_lot_id uuid;
BEGIN
  IF NEW.source_type = 'manufacturing_production' AND NEW.quantity_in > 0 THEN
    SELECT output_lot_id INTO v_lot_id
    FROM public.manufacturing_production_entries
    WHERE id = NEW.source_id AND organization_id = NEW.organization_id AND product_id = NEW.product_id AND manufacturing_version = 2;
    NEW.lot_id := v_lot_id;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_stamp_manufacturing_receipt_lot
BEFORE INSERT ON public.product_stock_movements
FOR EACH ROW EXECUTE FUNCTION public.stamp_manufacturing_receipt_lot();
