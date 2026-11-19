-- VSLA v1.2 request resolution: service requests and disputes are submitted by
-- members, but may only be concluded through these controlled RPCs.

ALTER TABLE public.vsla_member_disputes
  ADD COLUMN IF NOT EXISTS resolution_note text,
  ADD COLUMN IF NOT EXISTS resolution_action text CHECK (resolution_action IN ('resolved','rejected'));

ALTER TABLE public.vsla_member_service_requests
  ADD COLUMN IF NOT EXISTS resolution_note text,
  ADD COLUMN IF NOT EXISTS resolution_action text CHECK (resolution_action IN ('resolved','rejected'));

-- `completed` remains accepted for historic rows; all new decisions use the
-- common resolved/rejected terminology.
ALTER TABLE public.vsla_member_service_requests
  DROP CONSTRAINT IF EXISTS vsla_member_service_requests_status_check;
ALTER TABLE public.vsla_member_service_requests
  ADD CONSTRAINT vsla_member_service_requests_status_check
  CHECK (status IN ('open','processing','completed','resolved','rejected'));

CREATE OR REPLACE FUNCTION public.vsla_v12_can_resolve_member_request(p_organization_id uuid, p_member_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id=auth.uid() AND s.organization_id=p_organization_id
        AND s.role IN ('admin','manager','super_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.vsla_group_role_assignments a
      JOIN public.vsla_members m ON m.id=p_member_id
      WHERE a.organization_id=p_organization_id AND a.staff_id=auth.uid() AND a.active
        AND (a.group_id IS NULL OR a.group_id=m.group_id)
        AND a.role IN ('chairperson','secretary','group_auditor','institutional_supervisor')
    );
$$;

CREATE OR REPLACE FUNCTION public.vsla_v12_protect_audit_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  RAISE EXCEPTION 'VSLA audit events are immutable';
END $$;

DROP TRIGGER IF EXISTS trg_vsla_v12_audit_event_immutable ON public.vsla_audit_events;
CREATE TRIGGER trg_vsla_v12_audit_event_immutable
  BEFORE UPDATE OR DELETE ON public.vsla_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.vsla_v12_protect_audit_event();

CREATE OR REPLACE FUNCTION public.vsla_v12_resolve_member_dispute(
  p_dispute_id uuid, p_resolve boolean, p_note text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.vsla_member_disputes%ROWTYPE; v_action text;
BEGIN
  SELECT * INTO d FROM public.vsla_member_disputes WHERE id=p_dispute_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VSLA dispute not found'; END IF;
  IF d.status NOT IN ('open','reviewing') THEN RAISE EXCEPTION 'Only open VSLA disputes can be decided'; END IF;
  IF NOT public.vsla_v12_can_resolve_member_request(d.organization_id,d.member_id) THEN
    RAISE EXCEPTION 'Your VSLA role cannot resolve member disputes';
  END IF;
  IF nullif(trim(coalesce(p_note,'')),'') IS NULL THEN RAISE EXCEPTION 'A resolution note is required'; END IF;
  v_action:=CASE WHEN p_resolve THEN 'resolved' ELSE 'rejected' END;
  UPDATE public.vsla_member_disputes
    SET status=v_action, resolved_at=now(), resolved_by=auth.uid(),
        resolution_action=v_action, resolution_note=trim(p_note)
    WHERE id=d.id;
  INSERT INTO public.vsla_audit_events(organization_id,actor_id,action,entity,entity_id,before_data,after_data,reason)
  VALUES(d.organization_id,auth.uid(),'member_dispute_'||v_action,'vsla_member_disputes',d.id,to_jsonb(d),
    jsonb_build_object('status',v_action,'resolution_note',trim(p_note)),trim(p_note));
  RETURN d.id;
END $$;

CREATE OR REPLACE FUNCTION public.vsla_v12_resolve_member_service_request(
  p_request_id uuid, p_resolve boolean, p_note text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.vsla_member_service_requests%ROWTYPE; v_action text;
BEGIN
  SELECT * INTO r FROM public.vsla_member_service_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VSLA service request not found'; END IF;
  IF r.status NOT IN ('open','processing') THEN RAISE EXCEPTION 'Only open VSLA service requests can be decided'; END IF;
  IF NOT public.vsla_v12_can_resolve_member_request(r.organization_id,r.member_id) THEN
    RAISE EXCEPTION 'Your VSLA role cannot resolve member service requests';
  END IF;
  IF nullif(trim(coalesce(p_note,'')),'') IS NULL THEN RAISE EXCEPTION 'A resolution note is required'; END IF;
  v_action:=CASE WHEN p_resolve THEN 'resolved' ELSE 'rejected' END;
  UPDATE public.vsla_member_service_requests
    SET status=v_action, completed_at=now(), completed_by=auth.uid(),
        resolution_action=v_action, resolution_note=trim(p_note)
    WHERE id=r.id;
  INSERT INTO public.vsla_audit_events(organization_id,actor_id,action,entity,entity_id,before_data,after_data,reason)
  VALUES(r.organization_id,auth.uid(),'member_service_request_'||v_action,'vsla_member_service_requests',r.id,to_jsonb(r),
    jsonb_build_object('status',v_action,'resolution_note',trim(p_note)),trim(p_note));
  RETURN r.id;
END $$;

REVOKE ALL ON FUNCTION public.vsla_v12_can_resolve_member_request(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vsla_v12_resolve_member_dispute(uuid,boolean,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vsla_v12_resolve_member_service_request(uuid,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vsla_v12_resolve_member_dispute(uuid,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vsla_v12_resolve_member_service_request(uuid,boolean,text) TO authenticated;
