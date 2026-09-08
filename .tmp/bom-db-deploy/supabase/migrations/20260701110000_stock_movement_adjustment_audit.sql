-- Capture who recorded stock movements and when they were actually entered.
-- movement_date remains the effective inventory date.

ALTER TABLE public.product_stock_movements
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.set_product_stock_movement_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff_id uuid;
BEGIN
  NEW.created_at := coalesce(NEW.created_at, now());
  IF NEW.created_by_staff_id IS NULL THEN
    SELECT s.id
    INTO v_staff_id
    FROM public.staff s
    WHERE s.id = auth.uid();
    NEW.created_by_staff_id := v_staff_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_product_stock_movement_audit ON public.product_stock_movements;
CREATE TRIGGER trg_set_product_stock_movement_audit
BEFORE INSERT ON public.product_stock_movements
FOR EACH ROW
EXECUTE FUNCTION public.set_product_stock_movement_audit();

CREATE INDEX IF NOT EXISTS idx_product_stock_movements_adjustment_audit
  ON public.product_stock_movements (organization_id, created_at DESC)
  WHERE source_type = 'adjustment';

COMMENT ON COLUMN public.product_stock_movements.created_at IS
  'Timestamp when the movement was recorded. movement_date is the effective inventory date.';

COMMENT ON COLUMN public.product_stock_movements.created_by_staff_id IS
  'Staff member who recorded the movement.';
