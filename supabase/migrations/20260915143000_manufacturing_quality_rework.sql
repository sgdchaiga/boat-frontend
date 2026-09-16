CREATE TABLE IF NOT EXISTS public.manufacturing_quality_rework (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  inspection_id uuid NOT NULL REFERENCES public.manufacturing_quality_inspections(id) ON DELETE RESTRICT,
  lot_id uuid NOT NULL REFERENCES public.product_lots(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('rework', 'return_to_supplier', 'scrap')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed')),
  reason text NOT NULL,
  resolution text,
  opened_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  completed_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (inspection_id)
);

CREATE INDEX IF NOT EXISTS idx_manufacturing_quality_rework_lot ON public.manufacturing_quality_rework (organization_id, lot_id, status);
ALTER TABLE public.manufacturing_quality_rework ENABLE ROW LEVEL SECURITY;
CREATE POLICY manufacturing_quality_rework_tenant_all ON public.manufacturing_quality_rework
FOR ALL TO authenticated
USING (public.is_platform_admin() OR (public.auth_staff_org_id() IS NOT NULL AND organization_id = public.auth_staff_org_id()))
WITH CHECK (public.is_platform_admin() OR (public.auth_staff_org_id() IS NOT NULL AND organization_id = public.auth_staff_org_id()));
GRANT SELECT, INSERT, UPDATE ON public.manufacturing_quality_rework TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_manufacturing_quality_rework()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_inspection public.manufacturing_quality_inspections%ROWTYPE;
BEGIN
  SELECT * INTO v_inspection FROM public.manufacturing_quality_inspections WHERE id = NEW.inspection_id;
  IF v_inspection.id IS NULL OR v_inspection.organization_id IS DISTINCT FROM NEW.organization_id OR v_inspection.lot_id IS DISTINCT FROM NEW.lot_id OR v_inspection.status NOT IN ('failed', 'on_hold') THEN
    RAISE EXCEPTION 'Corrective action requires a failed or held inspection for the same lot';
  END IF;
  IF TG_OP = 'INSERT' AND EXISTS (SELECT 1 FROM public.manufacturing_quality_rework WHERE lot_id = NEW.lot_id AND status <> 'completed') THEN
    RAISE EXCEPTION 'This lot already has an open corrective action';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.inspection_id IS DISTINCT FROM OLD.inspection_id OR NEW.lot_id IS DISTINCT FROM OLD.lot_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.action IS DISTINCT FROM OLD.action THEN
      RAISE EXCEPTION 'Corrective action source and type cannot be changed';
    END IF;
    IF OLD.status = 'completed' AND NEW.status <> 'completed' THEN RAISE EXCEPTION 'Completed corrective action cannot be reopened'; END IF;
    IF NEW.status = 'completed' AND (nullif(trim(coalesce(NEW.resolution, '')), '') IS NULL OR NEW.completed_at IS NULL) THEN
      RAISE EXCEPTION 'Completion requires a resolution and completion time';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_manufacturing_quality_rework
BEFORE INSERT OR UPDATE ON public.manufacturing_quality_rework
FOR EACH ROW EXECUTE FUNCTION public.validate_manufacturing_quality_rework();

CREATE OR REPLACE FUNCTION public.hold_rework_lot()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE public.product_lots SET status = CASE WHEN NEW.action IN ('scrap', 'return_to_supplier') AND NEW.status = 'completed' THEN 'rejected' ELSE 'on_hold' END, updated_at = now()
  WHERE id = NEW.lot_id AND organization_id = NEW.organization_id;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_hold_rework_lot
AFTER INSERT OR UPDATE OF status ON public.manufacturing_quality_rework
FOR EACH ROW EXECUTE FUNCTION public.hold_rework_lot();

CREATE OR REPLACE FUNCTION public.apply_quality_inspection_lot_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.lot_id IS NOT NULL AND NEW.status = 'passed' AND EXISTS (
    SELECT 1 FROM public.manufacturing_quality_rework r
    WHERE r.lot_id = NEW.lot_id AND r.organization_id = NEW.organization_id
      AND (r.status <> 'completed' OR r.action <> 'rework' OR r.completed_at >= NEW.created_at)
  ) THEN
    RAISE EXCEPTION 'Complete rework and create a fresh passing inspection before releasing this lot';
  END IF;
  IF NEW.lot_id IS NOT NULL THEN
    UPDATE public.product_lots SET status = CASE NEW.status WHEN 'passed' THEN 'available' WHEN 'failed' THEN 'rejected' WHEN 'on_hold' THEN 'on_hold' ELSE status END, updated_at = now()
    WHERE id = NEW.lot_id AND organization_id = NEW.organization_id;
  END IF;
  RETURN NEW;
END; $$;
