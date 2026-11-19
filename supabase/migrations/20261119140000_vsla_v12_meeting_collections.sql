-- BOAT VSLA v1.2 / Phase 1: controlled routine collections in an open meeting.

CREATE OR REPLACE FUNCTION public.vsla_v12_receive_savings(
  p_meeting_id uuid, p_member_id uuid, p_shares integer, p_idempotency_key uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid; v_cycle uuid; v_group uuid; v_share_value numeric; v_max integer; v_existing integer; v_id uuid; v_ref text;
BEGIN
  SELECT organization_id,cycle_id INTO v_org,v_cycle FROM public.vsla_meetings WHERE id=p_meeting_id AND status='open' FOR UPDATE;
  IF v_org IS NULL OR v_org<>public.auth_staff_org_id() THEN RAISE EXCEPTION 'Open meeting not found'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.vsla_workflow_settings WHERE organization_id=v_org AND workflow_version='v1_2') THEN RAISE EXCEPTION 'VSLA v1.2 is not enabled for this organization'; END IF;
  IF p_shares<=0 THEN RAISE EXCEPTION 'At least one share is required'; END IF;
  SELECT group_id INTO v_group FROM public.vsla_members WHERE id=p_member_id AND organization_id=v_org AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Active member not found'; END IF;
  SELECT share_value,max_shares_per_meeting INTO v_share_value,v_max FROM public.vsla_settings WHERE organization_id=v_org;
  IF v_share_value IS NULL OR v_max IS NULL THEN RAISE EXCEPTION 'Configure share value and maximum shares before receiving savings'; END IF;
  SELECT coalesce(sum((metadata->>'shares')::integer),0) INTO v_existing FROM public.vsla_financial_events
    WHERE meeting_id=p_meeting_id AND member_id=p_member_id AND event_type='savings_received' AND status='posted';
  IF v_existing+p_shares>v_max THEN RAISE EXCEPTION 'Maximum shares per meeting is %',v_max; END IF;
  SELECT id INTO v_id FROM public.vsla_financial_events WHERE organization_id=v_org AND idempotency_key=p_idempotency_key;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  v_ref:='V12-SAV-'||replace(p_idempotency_key::text,'-','');
  INSERT INTO public.vsla_financial_events(organization_id,group_id,cycle_id,member_id,meeting_id,event_type,status,amount,effective_date,reference,idempotency_key,metadata,created_by,posted_at)
  VALUES(v_org,v_group,v_cycle,p_member_id,p_meeting_id,'savings_received','posted',p_shares*v_share_value,current_date,v_ref,p_idempotency_key,jsonb_build_object('shares',p_shares,'share_value',v_share_value),auth.uid(),now()) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.vsla_v12_receive_member_collection(
  p_meeting_id uuid, p_member_id uuid, p_event_type text, p_amount numeric, p_idempotency_key uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid; v_cycle uuid; v_group uuid; v_id uuid; v_ref text;
BEGIN
  SELECT organization_id,cycle_id INTO v_org,v_cycle FROM public.vsla_meetings WHERE id=p_meeting_id AND status='open' FOR UPDATE;
  IF v_org IS NULL OR v_org<>public.auth_staff_org_id() THEN RAISE EXCEPTION 'Open meeting not found'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.vsla_workflow_settings WHERE organization_id=v_org AND workflow_version='v1_2') THEN RAISE EXCEPTION 'VSLA v1.2 is not enabled for this organization'; END IF;
  IF p_event_type NOT IN ('fine_received','social_fund_received') THEN RAISE EXCEPTION 'Unsupported member collection'; END IF;
  IF p_amount<=0 THEN RAISE EXCEPTION 'A positive amount is required'; END IF;
  SELECT group_id INTO v_group FROM public.vsla_members WHERE id=p_member_id AND organization_id=v_org AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Active member not found'; END IF;
  SELECT id INTO v_id FROM public.vsla_financial_events WHERE organization_id=v_org AND idempotency_key=p_idempotency_key;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  v_ref:='V12-'||CASE WHEN p_event_type='fine_received' THEN 'FINE-' ELSE 'SOCIAL-' END||replace(p_idempotency_key::text,'-','');
  INSERT INTO public.vsla_financial_events(organization_id,group_id,cycle_id,member_id,meeting_id,event_type,status,amount,effective_date,reference,idempotency_key,metadata,created_by,posted_at)
  VALUES(v_org,v_group,v_cycle,p_member_id,p_meeting_id,p_event_type,'posted',p_amount,current_date,v_ref,p_idempotency_key,'{}'::jsonb,auth.uid(),now()) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.vsla_v12_receive_savings(uuid,uuid,integer,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vsla_v12_receive_member_collection(uuid,uuid,text,numeric,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vsla_v12_receive_savings(uuid,uuid,integer,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vsla_v12_receive_member_collection(uuid,uuid,text,numeric,uuid) TO authenticated;
