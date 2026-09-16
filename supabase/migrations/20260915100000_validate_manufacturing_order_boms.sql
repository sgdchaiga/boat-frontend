-- Production orders must reference a recipe for the same tenant and finished product.
-- This prevents a production entry from being attached to an unrelated order.
CREATE OR REPLACE FUNCTION public.validate_manufacturing_work_order_bom()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_bom_product_name text;
BEGIN
  IF NEW.manufacturing_version <> 2 THEN RETURN NEW; END IF;
  IF NEW.bom_id IS NULL THEN
    RAISE EXCEPTION 'A production order requires a bill of materials';
  END IF;

  SELECT product_name INTO v_bom_product_name
  FROM public.manufacturing_boms
  WHERE id = NEW.bom_id AND organization_id = NEW.organization_id;

  IF v_bom_product_name IS NULL THEN
    RAISE EXCEPTION 'The selected bill of materials is unavailable to this organization';
  END IF;
  IF NEW.product_name IS DISTINCT FROM v_bom_product_name THEN
    RAISE EXCEPTION 'Production order product must match its bill of materials';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_manufacturing_work_order_bom ON public.manufacturing_work_orders;
CREATE TRIGGER trg_validate_manufacturing_work_order_bom
BEFORE INSERT OR UPDATE OF bom_id, product_name, organization_id ON public.manufacturing_work_orders
FOR EACH ROW EXECUTE FUNCTION public.validate_manufacturing_work_order_bom();

CREATE OR REPLACE FUNCTION public.validate_manufacturing_production_order()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_order_product_name text;
BEGIN
  IF NEW.manufacturing_version <> 2 THEN RETURN NEW; END IF;
  IF NEW.work_order_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT product_name INTO v_order_product_name
  FROM public.manufacturing_work_orders
  WHERE id = NEW.work_order_id AND organization_id = NEW.organization_id;

  IF v_order_product_name IS NULL THEN
    RAISE EXCEPTION 'The selected production order is unavailable to this organization';
  END IF;
  IF NEW.product_name IS DISTINCT FROM v_order_product_name THEN
    RAISE EXCEPTION 'Finished product must match the selected production order';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_manufacturing_production_order ON public.manufacturing_production_entries;
CREATE TRIGGER trg_validate_manufacturing_production_order
BEFORE INSERT OR UPDATE OF work_order_id, product_name, organization_id ON public.manufacturing_production_entries
FOR EACH ROW EXECUTE FUNCTION public.validate_manufacturing_production_order();
