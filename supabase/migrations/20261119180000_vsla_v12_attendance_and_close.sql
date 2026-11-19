-- BOAT VSLA v1.2 / Phase 2: attendance and controlled meeting closure.
CREATE OR REPLACE FUNCTION public.vsla_v12_set_attendance(p_meeting_id uuid,p_member_id uuid,p_present boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid;
BEGIN
 SELECT organization_id INTO v_org FROM public.vsla_meetings WHERE id=p_meeting_id AND status='open' FOR UPDATE;
 IF v_org IS NULL OR v_org<>public.auth_staff_org_id() THEN RAISE EXCEPTION 'Open meeting not found'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.vsla_members WHERE id=p_member_id AND organization_id=v_org AND status='active') THEN RAISE EXCEPTION 'Active member not found'; END IF;
 INSERT INTO public.vsla_meeting_attendance(organization_id,meeting_id,member_id,present) VALUES(v_org,p_meeting_id,p_member_id,p_present)
 ON CONFLICT(meeting_id,member_id) DO UPDATE SET present=EXCLUDED.present;
END $$;
CREATE OR REPLACE FUNCTION public.vsla_v12_close_meeting(p_meeting_id uuid,p_notes text,p_chair_name text,p_secretary_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid; v_members int; v_attendance int; v_present int;
BEGIN
 SELECT organization_id INTO v_org FROM public.vsla_meetings WHERE id=p_meeting_id AND status='open' FOR UPDATE;
 IF v_org IS NULL OR v_org<>public.auth_staff_org_id() THEN RAISE EXCEPTION 'Open meeting not found'; END IF;
 SELECT count(*) INTO v_members FROM public.vsla_members WHERE organization_id=v_org AND status='active'; SELECT count(*),count(*) FILTER(WHERE present) INTO v_attendance,v_present FROM public.vsla_meeting_attendance WHERE meeting_id=p_meeting_id;
 IF v_attendance<v_members OR v_present=0 THEN RAISE EXCEPTION 'Record attendance for every active member and confirm at least one attendee'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.vsla_v12_cash_reconciliations WHERE meeting_id=p_meeting_id AND status='reconciled') THEN RAISE EXCEPTION 'Reconcile cash before closing the meeting'; END IF;
 IF EXISTS(SELECT 1 FROM public.vsla_financial_approval_requests r JOIN public.vsla_financial_events e ON e.id=r.event_id WHERE e.meeting_id=p_meeting_id AND r.status='pending') THEN RAISE EXCEPTION 'Resolve pending approvals before closing the meeting'; END IF;
 IF nullif(trim(coalesce(p_notes,'')),'') IS NULL OR nullif(trim(coalesce(p_chair_name,'')),'') IS NULL OR nullif(trim(coalesce(p_secretary_name,'')),'') IS NULL THEN RAISE EXCEPTION 'Meeting notes, chairperson, and secretary confirmations are required'; END IF;
 PERFORM public.vsla_save_structured_minutes(p_meeting_id,p_notes,jsonb_build_array(jsonb_build_object('item','v1.2 guided meeting')), '[]'::jsonb, jsonb_build_array(jsonb_build_object('name',p_chair_name,'confirmed',true),jsonb_build_object('name',p_secretary_name,'confirmed',true)),1,v_present,true);
 UPDATE public.vsla_meetings SET completed_steps=ARRAY['attendance','savings','loans','repayments','cash'],status='closed' WHERE id=p_meeting_id;
 INSERT INTO public.vsla_audit_events(organization_id,actor_id,action,entity,entity_id,after_data) VALUES(v_org,auth.uid(),'meeting_closed','vsla_meetings',p_meeting_id,jsonb_build_object('attendance',v_present));
END $$;
REVOKE ALL ON FUNCTION public.vsla_v12_set_attendance(uuid,uuid,boolean),public.vsla_v12_close_meeting(uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vsla_v12_set_attendance(uuid,uuid,boolean),public.vsla_v12_close_meeting(uuid,text,text,text) TO authenticated;
