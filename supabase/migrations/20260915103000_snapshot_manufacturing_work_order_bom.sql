-- Preserve the recipe used for planning even when the master BOM is revised later.
ALTER TABLE public.manufacturing_work_orders
  ADD COLUMN IF NOT EXISTS bom_version text,
  ADD COLUMN IF NOT EXISTS bom_snapshot jsonb;

CREATE OR REPLACE FUNCTION public.snapshot_manufacturing_work_order_bom()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_bom public.manufacturing_boms%ROWTYPE;
BEGIN
  IF NEW.manufacturing_version <> 2 THEN RETURN NEW; END IF;
  SELECT * INTO v_bom
  FROM public.manufacturing_boms
  WHERE id = NEW.bom_id AND organization_id = NEW.organization_id;

  IF v_bom.id IS NULL THEN
    RAISE EXCEPTION 'The selected bill of materials is unavailable to this organization';
  END IF;

  NEW.product_name := v_bom.product_name;
  NEW.bom_version := v_bom.version;
  NEW.bom_snapshot := jsonb_build_object(
    'bom_id', v_bom.id,
    'version', v_bom.version,
    'product_id', v_bom.product_id,
    'product_name', v_bom.product_name,
    'output_qty', v_bom.output_qty,
    'output_unit', v_bom.output_unit,
    'materials', coalesce(v_bom.materials, '[]'::jsonb),
    'expected_scrap_qty', coalesce(v_bom.expected_scrap_qty, 0)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_manufacturing_work_order_bom ON public.manufacturing_work_orders;
CREATE TRIGGER trg_snapshot_manufacturing_work_order_bom
BEFORE INSERT OR UPDATE OF bom_id ON public.manufacturing_work_orders
FOR EACH ROW EXECUTE FUNCTION public.snapshot_manufacturing_work_order_bom();

-- Historical V1 orders are deliberately left untouched.

CREATE OR REPLACE FUNCTION public.protect_manufacturing_work_order_bom_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.manufacturing_version <> 2 THEN RETURN NEW; END IF;
  IF NEW.bom_id IS NOT DISTINCT FROM OLD.bom_id
    AND (NEW.bom_version IS DISTINCT FROM OLD.bom_version OR NEW.bom_snapshot IS DISTINCT FROM OLD.bom_snapshot) THEN
    RAISE EXCEPTION 'The production order BOM snapshot cannot be edited directly';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_manufacturing_work_order_bom_snapshot ON public.manufacturing_work_orders;
CREATE TRIGGER trg_protect_manufacturing_work_order_bom_snapshot
BEFORE UPDATE ON public.manufacturing_work_orders
FOR EACH ROW EXECUTE FUNCTION public.protect_manufacturing_work_order_bom_snapshot();

COMMENT ON COLUMN public.manufacturing_work_orders.bom_snapshot IS
  'Immutable planning copy of the BOM selected when the production order was created.';
