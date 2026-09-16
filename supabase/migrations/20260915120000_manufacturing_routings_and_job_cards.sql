-- Phase 2 foundation: routings describe how a BOM is made; job cards execute it.
CREATE TABLE IF NOT EXISTS public.manufacturing_work_centers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text,
  capacity_per_hour numeric(18,3) NOT NULL DEFAULT 1 CHECK (capacity_per_hour > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS public.manufacturing_routing_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bom_id uuid NOT NULL REFERENCES public.manufacturing_boms(id) ON DELETE CASCADE,
  sequence_no integer NOT NULL CHECK (sequence_no > 0),
  operation_name text NOT NULL,
  work_center_id uuid REFERENCES public.manufacturing_work_centers(id) ON DELETE SET NULL,
  planned_minutes numeric(18,2) NOT NULL DEFAULT 0 CHECK (planned_minutes >= 0),
  instructions text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bom_id, sequence_no)
);

CREATE TABLE IF NOT EXISTS public.manufacturing_job_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  work_order_id uuid NOT NULL REFERENCES public.manufacturing_work_orders(id) ON DELETE CASCADE,
  routing_operation_id uuid REFERENCES public.manufacturing_routing_operations(id) ON DELETE SET NULL,
  sequence_no integer NOT NULL,
  operation_name text NOT NULL,
  work_center_id uuid REFERENCES public.manufacturing_work_centers(id) ON DELETE SET NULL,
  planned_minutes numeric(18,2) NOT NULL DEFAULT 0 CHECK (planned_minutes >= 0),
  actual_minutes numeric(18,2) NOT NULL DEFAULT 0 CHECK (actual_minutes >= 0),
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'In Progress', 'Completed', 'Blocked')),
  instructions text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_order_id, sequence_no)
);

CREATE INDEX IF NOT EXISTS idx_manufacturing_routing_operations_bom ON public.manufacturing_routing_operations (organization_id, bom_id, sequence_no);
CREATE INDEX IF NOT EXISTS idx_manufacturing_job_cards_order ON public.manufacturing_job_cards (organization_id, work_order_id, sequence_no);

ALTER TABLE public.manufacturing_work_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manufacturing_routing_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manufacturing_job_cards ENABLE ROW LEVEL SECURITY;
DO $pol$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['manufacturing_work_centers', 'manufacturing_routing_operations', 'manufacturing_job_cards'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_tenant_all', tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_platform_admin() OR (public.auth_staff_org_id() IS NOT NULL AND organization_id = public.auth_staff_org_id())) WITH CHECK (public.is_platform_admin() OR (public.auth_staff_org_id() IS NOT NULL AND organization_id = public.auth_staff_org_id()))', tbl || '_tenant_all', tbl);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', tbl);
  END LOOP;
END $pol$;

CREATE OR REPLACE FUNCTION public.release_manufacturing_work_order(p_work_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order public.manufacturing_work_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.manufacturing_work_orders WHERE id = p_work_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'Production order not found'; END IF;
  IF (public.is_platform_admin() OR public.auth_staff_org_id() = v_order.organization_id) IS NOT TRUE THEN RAISE EXCEPTION 'Not permitted'; END IF;
  IF NOT public.manufacturing_v2_enabled(v_order.organization_id) OR v_order.manufacturing_version <> 2 THEN RAISE EXCEPTION 'This operation requires a Manufacturing V2 order'; END IF;
  IF v_order.status <> 'Planned' THEN RAISE EXCEPTION 'Only planned production orders can be released'; END IF;
  IF EXISTS (SELECT 1 FROM public.manufacturing_material_reservations WHERE work_order_id = p_work_order_id AND status NOT IN ('reserved', 'consumed')) THEN RAISE EXCEPTION 'Reserve all production materials before releasing this order'; END IF;
  INSERT INTO public.manufacturing_job_cards (organization_id, work_order_id, routing_operation_id, sequence_no, operation_name, work_center_id, planned_minutes, instructions)
  SELECT v_order.organization_id, v_order.id, operation.id, operation.sequence_no, operation.operation_name, operation.work_center_id, operation.planned_minutes, operation.instructions
  FROM public.manufacturing_routing_operations operation
  WHERE operation.organization_id = v_order.organization_id AND operation.bom_id = v_order.bom_id
  ON CONFLICT (work_order_id, sequence_no) DO NOTHING;
  UPDATE public.manufacturing_work_orders SET status = 'In Progress' WHERE id = p_work_order_id;
END; $$;
