ALTER TABLE public.manufacturing_production_entries
  ADD COLUMN IF NOT EXISTS output_lot_id uuid REFERENCES public.product_lots(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.validate_manufacturing_output_lot()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.manufacturing_version <> 2 THEN RETURN NEW; END IF;
  IF NEW.output_lot_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.product_lots WHERE id = NEW.output_lot_id AND organization_id = NEW.organization_id AND product_id = NEW.product_id AND status NOT IN ('rejected', 'on_hold')) THEN
    RAISE EXCEPTION 'Finished-goods lot must belong to this product and be available';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_validate_manufacturing_output_lot BEFORE INSERT OR UPDATE OF output_lot_id, product_id ON public.manufacturing_production_entries FOR EACH ROW EXECUTE FUNCTION public.validate_manufacturing_output_lot();
