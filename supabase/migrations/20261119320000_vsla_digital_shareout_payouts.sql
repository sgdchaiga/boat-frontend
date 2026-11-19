-- Phase 4: each digital share-out payout is constrained to the approved payout
-- schedule and is posted only after independently matched provider evidence.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vsla_v12_shareout_payment_member
  ON public.vsla_financial_events ((metadata->>'shareout_id'),member_id)
  WHERE event_type='shareout_payment' AND status IN ('posted','reversed');

CREATE OR REPLACE FUNCTION public.vsla_v12_create_shareout_payout_intent(
  p_shareout_id uuid,p_member_id uuid,p_provider text,p_idempotency_key uuid DEFAULT gen_random_uuid()
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.vsla_v12_shareouts%ROWTYPE; v_org uuid; v_amount numeric; v_intent uuid; v_reference text;
BEGIN
  SELECT organization_id INTO v_org FROM public.staff WHERE id=auth.uid();
  IF v_org IS NULL OR NOT public.vsla_v12_actor_has_role(v_org,NULL,ARRAY['chairperson','treasurer']) THEN RAISE EXCEPTION 'Your VSLA role cannot create a share-out payout'; END IF;
  IF nullif(trim(coalesce(p_provider,'')),'') IS NULL THEN RAISE EXCEPTION 'A BOAT Pay provider is required for a share-out payout'; END IF;
  SELECT * INTO s FROM public.vsla_v12_shareouts WHERE id=p_shareout_id FOR UPDATE;
  IF NOT FOUND OR s.organization_id<>v_org OR s.status<>'approved' THEN RAISE EXCEPTION 'Approved share-out was not found'; END IF;
  SELECT (entry->>'payout_amount')::numeric INTO v_amount FROM jsonb_array_elements(s.payout_schedule) entry WHERE (entry->>'member_id')::uuid=p_member_id;
  IF v_amount IS NULL OR v_amount<=0 THEN RAISE EXCEPTION 'Member has no approved share-out entitlement'; END IF;
  SELECT id INTO v_intent FROM public.boat_pay_payment_intents WHERE organization_id=v_org AND idempotency_key=p_idempotency_key; IF v_intent IS NOT NULL THEN RETURN v_intent; END IF;
  IF EXISTS(SELECT 1 FROM public.boat_pay_payment_intents WHERE shareout_id=s.id AND member_id=p_member_id AND purpose='shareout_payout' AND status NOT IN ('failed','reversed','refunded','cancelled')) THEN RAISE EXCEPTION 'An active payout request already exists for this member entitlement'; END IF;
  v_reference:='VSLAPAY-'||replace(p_idempotency_key::text,'-','');
  INSERT INTO public.boat_pay_payment_intents(organization_id,module_code,purpose,member_id,shareout_id,provider,channel,provider_reference,idempotency_key,amount,metadata,created_by)
  VALUES(v_org,'vsla','shareout_payout',p_member_id,s.id,lower(trim(p_provider)),'mobile_money',v_reference,p_idempotency_key,v_amount,jsonb_build_object('cycle_id',s.cycle_id),auth.uid()) RETURNING id INTO v_intent;
  INSERT INTO public.vsla_audit_events(organization_id,actor_id,action,entity,entity_id,after_data) VALUES(v_org,auth.uid(),'boat_pay_shareout_payout_intent_created','boat_pay_payment_intents',v_intent,jsonb_build_object('shareout_id',s.id,'member_id',p_member_id,'amount',v_amount,'reference',v_reference));
  RETURN v_intent;
END $$;

CREATE OR REPLACE FUNCTION public.vsla_v12_finalize_shareout_payout(p_intent_id uuid,p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE i public.boat_pay_payment_intents%ROWTYPE; pe public.boat_pay_payment_events%ROWTYPE; s public.vsla_v12_shareouts%ROWTYPE; v_org uuid; v_amount numeric; v_event uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.staff WHERE id=auth.uid();
  IF v_org IS NULL OR NOT public.vsla_v12_actor_has_role(v_org,NULL,ARRAY['chairperson','treasurer']) THEN RAISE EXCEPTION 'Your VSLA role cannot finalize a share-out payout'; END IF;
  SELECT * INTO i FROM public.boat_pay_payment_intents WHERE id=p_intent_id FOR UPDATE;
  IF NOT FOUND OR i.organization_id<>v_org OR i.purpose<>'shareout_payout' THEN RAISE EXCEPTION 'Share-out payout request was not found'; END IF;
  IF i.status='settled' AND i.settlement_event_id IS NOT NULL THEN RETURN i.settlement_event_id; END IF;
  IF i.status<>'matched' THEN RAISE EXCEPTION 'A matched provider payout is required before share-out settlement'; END IF;
  SELECT * INTO pe FROM public.boat_pay_payment_events WHERE payment_intent_id=i.id AND status='matched' FOR UPDATE;
  IF NOT FOUND OR pe.direction<>'outgoing' OR pe.matched_by IS NULL OR pe.matched_by=auth.uid() THEN RAISE EXCEPTION 'A separately matched outgoing provider payout is required'; END IF;
  SELECT * INTO s FROM public.vsla_v12_shareouts WHERE id=i.shareout_id FOR UPDATE;
  SELECT (entry->>'payout_amount')::numeric INTO v_amount FROM jsonb_array_elements(s.payout_schedule) entry WHERE (entry->>'member_id')::uuid=i.member_id;
  IF NOT FOUND OR s.status<>'approved' OR v_amount IS NULL OR i.amount<>v_amount THEN RAISE EXCEPTION 'Payout no longer matches the approved member entitlement'; END IF;
  IF EXISTS(SELECT 1 FROM public.vsla_financial_events WHERE event_type='shareout_payment' AND member_id=i.member_id AND metadata->>'shareout_id'=s.id::text AND status IN ('posted','reversed')) THEN RAISE EXCEPTION 'This member share-out entitlement is already settled'; END IF;
  INSERT INTO public.vsla_financial_events(organization_id,cycle_id,member_id,event_type,status,amount,effective_date,reference,idempotency_key,metadata,created_by,posted_at)
  VALUES(v_org,s.cycle_id,i.member_id,'shareout_payment','posted',i.amount,current_date,'V12-SHAREPAY-'||replace(i.id::text,'-',''),i.id,jsonb_build_object('shareout_id',s.id,'payment_intent_id',i.id,'payment_event_id',pe.id),auth.uid(),now()) RETURNING id INTO v_event;
  UPDATE public.boat_pay_payment_events SET status='settled',reconciliation_note=coalesce(nullif(trim(coalesce(p_note,'')),''),reconciliation_note) WHERE id=pe.id;
  UPDATE public.boat_pay_payment_intents SET status='settled',settlement_event_id=v_event,settled_at=now(),settled_by=auth.uid() WHERE id=i.id;
  INSERT INTO public.vsla_audit_events(organization_id,actor_id,action,entity,entity_id,after_data,reason) VALUES(v_org,auth.uid(),'boat_pay_shareout_payout_finalized','boat_pay_payment_intents',i.id,jsonb_build_object('shareout_id',s.id,'member_id',i.member_id,'payment_event_id',pe.id,'ledger_event_id',v_event),nullif(trim(coalesce(p_note,'')),''));
  RETURN v_event;
END $$;

CREATE OR REPLACE FUNCTION public.vsla_v12_close_cycle(p_cycle_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.vsla_cycles%ROWTYPE; s public.vsla_v12_shareouts%ROWTYPE; v_unsettled integer;
BEGIN
  SELECT * INTO c FROM public.vsla_cycles WHERE id=p_cycle_id FOR UPDATE;
  IF NOT FOUND OR c.organization_id<>public.auth_staff_org_id() OR c.status<>'active' THEN RAISE EXCEPTION 'Active VSLA cycle not found'; END IF;
  IF NOT public.vsla_v12_actor_has_role(c.organization_id,NULL,ARRAY['chairperson','treasurer']) THEN RAISE EXCEPTION 'Your VSLA role cannot close this VSLA cycle'; END IF;
  SELECT * INTO s FROM public.vsla_v12_shareouts WHERE cycle_id=c.id AND status='approved' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'An approved share-out is required before closing this v1.2 cycle'; END IF;
  SELECT count(*) INTO v_unsettled FROM jsonb_array_elements(s.payout_schedule) entry WHERE NOT EXISTS(SELECT 1 FROM public.boat_pay_payment_intents i WHERE i.shareout_id=s.id AND i.member_id=(entry->>'member_id')::uuid AND i.purpose='shareout_payout' AND i.status='settled');
  IF v_unsettled>0 THEN RAISE EXCEPTION 'Resolve all approved share-out payout obligations before closing the cycle'; END IF;
  UPDATE public.vsla_cycles SET status='closed',ends_on=current_date,closed_at=now() WHERE id=c.id;
  INSERT INTO public.vsla_audit_events(organization_id,actor_id,action,entity,entity_id,after_data) VALUES(c.organization_id,auth.uid(),'v12_cycle_closed','vsla_cycles',c.id,jsonb_build_object('shareout_id',s.id));
END $$;

REVOKE ALL ON FUNCTION public.vsla_v12_create_shareout_payout_intent(uuid,uuid,text,uuid),public.vsla_v12_finalize_shareout_payout(uuid,text),public.vsla_v12_close_cycle(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vsla_v12_create_shareout_payout_intent(uuid,uuid,text,uuid),public.vsla_v12_finalize_shareout_payout(uuid,text),public.vsla_v12_close_cycle(uuid) TO authenticated;
