-- Manufacturing V2 is opt-in. No existing organization is enrolled by deployment.
CREATE TABLE public.manufacturing_org_versions (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  version smallint NOT NULL DEFAULT 1 CHECK (version IN (1, 2)),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.manufacturing_org_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY manufacturing_org_versions_read ON public.manufacturing_org_versions
FOR SELECT TO authenticated USING (public.is_platform_admin() OR organization_id = public.auth_staff_org_id());
GRANT SELECT ON public.manufacturing_org_versions TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.manufacturing_org_versions FROM authenticated;

CREATE FUNCTION public.manufacturing_v2_enabled(p_organization_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.manufacturing_org_versions WHERE organization_id = p_organization_id AND version = 2)
$$;
REVOKE ALL ON FUNCTION public.manufacturing_v2_enabled(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manufacturing_v2_enabled(uuid) TO authenticated;

ALTER TABLE public.manufacturing_work_orders
  ADD COLUMN manufacturing_version smallint NOT NULL DEFAULT 1 CHECK (manufacturing_version IN (1, 2));
ALTER TABLE public.manufacturing_production_entries
  ADD COLUMN manufacturing_version smallint NOT NULL DEFAULT 1 CHECK (manufacturing_version IN (1, 2));

CREATE FUNCTION public.stamp_manufacturing_record_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_order_version smallint;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- An upgrade does not change how historical documents are posted.
    NEW.manufacturing_version := OLD.manufacturing_version;
    IF TG_TABLE_NAME = 'manufacturing_production_entries' THEN
      IF NEW.work_order_id IS DISTINCT FROM OLD.work_order_id AND NEW.work_order_id IS NOT NULL THEN
        SELECT manufacturing_version INTO v_order_version FROM public.manufacturing_work_orders
        WHERE id = NEW.work_order_id AND organization_id = NEW.organization_id;
        IF v_order_version IS NOT NULL AND v_order_version <> OLD.manufacturing_version THEN
          RAISE EXCEPTION 'A production entry cannot move between V1 and V2 orders';
        END IF;
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  -- Serialize an explicit version change with creation of a new document.
  PERFORM 1 FROM public.organizations WHERE id = NEW.organization_id FOR KEY SHARE;
  NEW.manufacturing_version := CASE WHEN public.manufacturing_v2_enabled(NEW.organization_id) THEN 2 ELSE 1 END;
  IF TG_TABLE_NAME = 'manufacturing_production_entries' THEN
    IF NEW.work_order_id IS NOT NULL THEN
      SELECT manufacturing_version INTO v_order_version FROM public.manufacturing_work_orders
      WHERE id = NEW.work_order_id AND organization_id = NEW.organization_id;
      IF v_order_version IS NOT NULL THEN NEW.manufacturing_version := v_order_version; END IF;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_00_manufacturing_order_version
BEFORE INSERT OR UPDATE ON public.manufacturing_work_orders
FOR EACH ROW EXECUTE FUNCTION public.stamp_manufacturing_record_version();
CREATE TRIGGER trg_00_manufacturing_entry_version
BEFORE INSERT OR UPDATE ON public.manufacturing_production_entries
FOR EACH ROW EXECUTE FUNCTION public.stamp_manufacturing_record_version();
