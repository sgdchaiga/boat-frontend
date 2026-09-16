ALTER TABLE public.manufacturing_job_cards ADD COLUMN IF NOT EXISTS block_reason text;

CREATE OR REPLACE FUNCTION public.validate_manufacturing_job_card()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_order public.manufacturing_work_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.manufacturing_work_orders
  WHERE id = NEW.work_order_id AND organization_id = NEW.organization_id FOR UPDATE;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'Job card must belong to a production order in the same organization'; END IF;
  IF v_order.manufacturing_version <> 2 OR NOT public.manufacturing_v2_enabled(NEW.organization_id) THEN
    RAISE EXCEPTION 'Job cards require a Manufacturing V2 order';
  END IF;
  IF NEW.work_center_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.manufacturing_work_centers WHERE id = NEW.work_center_id AND organization_id = NEW.organization_id
  ) THEN RAISE EXCEPTION 'Work centre must belong to the same organization'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'Pending' THEN RAISE EXCEPTION 'New job cards must be pending'; END IF;
    NEW.started_at := NULL; NEW.completed_at := NULL;
  ELSE
    IF (NEW.organization_id, NEW.work_order_id, NEW.sequence_no) IS DISTINCT FROM
       (OLD.organization_id, OLD.work_order_id, OLD.sequence_no) THEN
      RAISE EXCEPTION 'The job card organization, order and sequence cannot be changed';
    END IF;
    IF OLD.status = 'Completed' AND (NEW.status, NEW.actual_minutes, NEW.block_reason) IS DISTINCT FROM
      (OLD.status, OLD.actual_minutes, OLD.block_reason) THEN RAISE EXCEPTION 'Completed job cards cannot be changed'; END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF v_order.status IN ('Planned', 'Cancelled') THEN RAISE EXCEPTION 'Release the production order before running its jobs'; END IF;
      IF NOT ((OLD.status = 'Pending' AND NEW.status = 'In Progress') OR
              (OLD.status = 'In Progress' AND NEW.status IN ('Completed', 'Blocked')) OR
              (OLD.status = 'Blocked' AND NEW.status = 'In Progress')) THEN
        RAISE EXCEPTION 'Invalid job status change from % to %', OLD.status, NEW.status;
      END IF;
    END IF;
    NEW.started_at := OLD.started_at;
    NEW.completed_at := OLD.completed_at;
    IF NEW.status = 'In Progress' AND OLD.status <> 'In Progress' THEN NEW.started_at := coalesce(OLD.started_at, now()); END IF;
    IF NEW.status = 'Completed' AND OLD.status <> 'Completed' THEN NEW.completed_at := now(); END IF;
  END IF;
  IF NEW.status = 'Blocked' AND nullif(trim(NEW.block_reason), '') IS NULL THEN RAISE EXCEPTION 'A blocked job requires a reason'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_manufacturing_job_card
BEFORE INSERT OR UPDATE ON public.manufacturing_job_cards
FOR EACH ROW EXECUTE FUNCTION public.validate_manufacturing_job_card();

REVOKE ALL ON FUNCTION public.reserve_manufacturing_work_order_materials(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_manufacturing_work_order(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_untracked_stock_to_lot(uuid, numeric) FROM PUBLIC;

-- New features are unavailable to V1 tenants even through direct API calls.
DO $policy$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'manufacturing_material_reservations', 'manufacturing_work_centers',
    'manufacturing_routing_operations', 'manufacturing_job_cards', 'product_lots',
    'manufacturing_quality_templates', 'manufacturing_quality_inspections', 'manufacturing_quality_rework'
  ] LOOP
    EXECUTE format('CREATE POLICY manufacturing_v2_only ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.manufacturing_v2_enabled(organization_id)) WITH CHECK (public.manufacturing_v2_enabled(organization_id))', v_table);
  END LOOP;
END $policy$;

CREATE FUNCTION public.set_manufacturing_version(p_organization_id uuid, p_version smallint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_platform_admin() IS NOT TRUE THEN RAISE EXCEPTION 'Only a platform administrator can change manufacturing versions'; END IF;
  IF p_version IS NULL OR p_version NOT IN (1, 2) THEN RAISE EXCEPTION 'Unsupported manufacturing version'; END IF;
  PERFORM 1 FROM public.organizations WHERE id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organization not found'; END IF;
  IF p_version = 1 AND (
    EXISTS (SELECT 1 FROM public.manufacturing_work_orders WHERE organization_id = p_organization_id AND manufacturing_version = 2) OR
    EXISTS (SELECT 1 FROM public.manufacturing_production_entries WHERE organization_id = p_organization_id AND manufacturing_version = 2) OR
    EXISTS (SELECT 1 FROM public.product_lots WHERE organization_id = p_organization_id)
  ) THEN RAISE EXCEPTION 'V2 production or lot records exist; reverting requires a reviewed data migration'; END IF;
  INSERT INTO public.manufacturing_org_versions(organization_id, version)
  VALUES(p_organization_id, p_version)
  ON CONFLICT(organization_id) DO UPDATE SET version = EXCLUDED.version, updated_at = now();
END; $$;
REVOKE ALL ON FUNCTION public.set_manufacturing_version(uuid, smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_manufacturing_version(uuid, smallint) TO authenticated;

CREATE FUNCTION public.protect_v1_production_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.manufacturing_version = 1 AND (NEW.output_lot_id IS NOT NULL OR NEW.material_lots <> '{}'::jsonb) THEN
    RAISE EXCEPTION 'V1 production entries cannot use V2 lot fields';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_protect_v1_production_fields BEFORE INSERT OR UPDATE ON public.manufacturing_production_entries
FOR EACH ROW EXECUTE FUNCTION public.protect_v1_production_fields();
