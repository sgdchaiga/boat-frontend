-- Phase 4: a mobile-money loan is authorized first and becomes disbursed only
-- after independently matched provider confirmation. Cash loans retain the
-- established approval-to-disbursement workflow.
ALTER TABLE public.vsla_v12_loans
  ADD COLUMN IF NOT EXISTS disbursement_channel text NOT NULL DEFAULT 'cash';
ALTER TABLE public.vsla_v12_loans DROP CONSTRAINT IF EXISTS vsla_v12_loans_disbursement_channel_check;
ALTER TABLE public.vsla_v12_loans ADD CONSTRAINT vsla_v12_loans_disbursement_channel_check CHECK (disbursement_channel IN ('cash','mobile_money'));
ALTER TABLE public.vsla_v12_loans DROP CONSTRAINT IF EXISTS vsla_v12_loans_status_check;
ALTER TABLE public.vsla_v12_loans ADD CONSTRAINT vsla_v12_loans_status_check CHECK (status IN ('draft','pending_approval','approved_pending_payout','disbursed','closed','rejected'));
ALTER TABLE public.vsla_financial_events DROP CONSTRAINT IF EXISTS vsla_financial_events_status_check;
ALTER TABLE public.vsla_financial_events ADD CONSTRAINT vsla_financial_events_status_check CHECK (status IN ('draft','pending_approval','approved_pending_settlement','posted','reversed','rejected'));

CREATE OR REPLACE FUNCTION public.vsla_v12_request_digital_loan(
  p_meeting_id uuid,p_member_id uuid,p_principal numeric,p_interest_rate numeric,p_duration integer,p_idempotency_key uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid; v_cycle uuid; v_loan uuid; v_event uuid; v_request uuid; v_total numeric; v_ref text;
BEGIN
  SELECT organization_id,cycle_id INTO v_org,v_cycle FROM public.vsla_meetings WHERE id=p_meeting_id AND status='open' FOR UPDATE;
  IF v_org IS NULL OR v_org<>public.auth_staff_org_id() THEN RAISE EXCEPTION 'Open meeting not found'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.vsla_workflow_settings WHERE organization_id=v_org AND workflow_version='v1_2') THEN RAISE EXCEPTION 'VSLA v1.2 is not enabled for this organization'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.boat_pay_provider_connections WHERE provider_code='flutterwave' AND enabled AND 'vsla'=ANY(module_codes)) THEN RAISE EXCEPTION 'Enable an approved BOAT Pay mobile-money provider before requesting a digital loan'; END IF;
  IF p_principal<=0 OR p_interest_rate<0 OR p_duration<=0 THEN RAISE EXCEPTION 'Loan amount, interest rate, and term must be valid'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.vsla_members WHERE id=p_member_id AND organization_id=v_org AND status='active') THEN RAISE EXCEPTION 'Active member not found'; END IF;
  SELECT id INTO v_event FROM public.vsla_financial_events WHERE organization_id=v_org AND idempotency_key=p_idempotency_key;
  IF v_event IS NOT NULL THEN RETURN (SELECT jsonb_build_object('event_id',v_event,'loan_id',metadata->>'loan_id') FROM public.vsla_financial_events WHERE id=v_event); END IF;
  v_total:=p_principal+(p_principal*p_interest_rate/100*p_duration); v_ref:='V12-LOAN-'||replace(p_idempotency_key::text,'-','');
  INSERT INTO public.vsla_v12_loans(organization_id,cycle_id,member_id,request_meeting_id,principal_amount,interest_rate_percent,duration_meetings,total_due,outstanding_balance,disbursement_channel,created_by)
  VALUES(v_org,v_cycle,p_member_id,p_meeting_id,p_principal,p_interest_rate,p_duration,v_total,v_total,'mobile_money',auth.uid()) RETURNING id INTO v_loan;
  INSERT INTO public.vsla_financial_events(organization_id,cycle_id,member_id,meeting_id,event_type,status,amount,effective_date,reference,idempotency_key,metadata,created_by)
  VALUES(v_org,v_cycle,p_member_id,p_meeting_id,'loan_disbursed','draft',p_principal,current_date,v_ref,p_idempotency_key,jsonb_build_object('loan_id',v_loan,'disbursement_channel','mobile_money'),auth.uid()) RETURNING id INTO v_event;
  UPDATE public.vsla_v12_loans SET disbursement_event_id=v_event,status='pending_approval' WHERE id=v_loan;
  v_request:=public.vsla_v12_submit_financial_draft(v_event);
  RETURN jsonb_build_object('loan_id',v_loan,'event_id',v_event,'approval_request_id',v_request);
END $$;

CREATE OR REPLACE FUNCTION public.vsla_v12_decide_financial_approval(p_request_id uuid,p_approve boolean,p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.vsla_financial_approval_requests%ROWTYPE; e public.vsla_financial_events%ROWTYPE; p public.vsla_approval_policies%ROWTYPE; l public.vsla_v12_loans%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.vsla_financial_approval_requests WHERE id=p_request_id FOR UPDATE; IF NOT FOUND OR r.organization_id<>public.auth_staff_org_id() OR r.status<>'pending' THEN RAISE EXCEPTION 'Approval request is not pending'; END IF;
  SELECT * INTO e FROM public.vsla_financial_events WHERE id=r.event_id FOR UPDATE; SELECT * INTO p FROM public.vsla_approval_policies WHERE id=r.policy_id;
  IF NOT FOUND OR NOT public.vsla_v12_actor_has_role(r.organization_id,r.group_id,p.checker_roles) THEN RAISE EXCEPTION 'Your VSLA role cannot approve this action'; END IF;
  IF p.require_distinct_users AND r.submitted_by=auth.uid() THEN RAISE EXCEPTION 'Maker and checker must be different users'; END IF;
  UPDATE public.vsla_financial_approval_requests SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,decided_by=auth.uid(),decided_at=now(),decision_note=nullif(trim(coalesce(p_note,'')),'') WHERE id=r.id;
  IF e.event_type='loan_disbursed' THEN
    SELECT * INTO l FROM public.vsla_v12_loans WHERE disbursement_event_id=e.id FOR UPDATE;
    IF p_approve AND l.disbursement_channel='mobile_money' THEN
      UPDATE public.vsla_financial_events SET status='approved_pending_settlement',posted_at=NULL WHERE id=e.id;
      UPDATE public.vsla_v12_loans SET status='approved_pending_payout',disbursed_at=NULL WHERE id=l.id;
    ELSE
      UPDATE public.vsla_financial_events SET status=CASE WHEN p_approve THEN 'posted' ELSE 'rejected' END,posted_at=CASE WHEN p_approve THEN now() ELSE NULL END WHERE id=e.id;
      UPDATE public.vsla_v12_loans SET status=CASE WHEN p_approve THEN 'disbursed' ELSE 'rejected' END,disbursed_at=CASE WHEN p_approve THEN now() ELSE NULL END WHERE id=l.id;
    END IF;
  ELSE
    UPDATE public.vsla_financial_events SET status=CASE WHEN p_approve THEN 'posted' ELSE 'rejected' END,posted_at=CASE WHEN p_approve THEN now() ELSE NULL END WHERE id=e.id;
  END IF;
  IF e.event_type='shareout_accrual' THEN UPDATE public.vsla_v12_shareouts SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,approved_at=CASE WHEN p_approve THEN now() ELSE NULL END WHERE approval_event_id=e.id; END IF;
  IF e.event_type='cash_adjustment' AND p_approve THEN UPDATE public.vsla_v12_cash_reconciliations SET status='reconciled' WHERE approval_request_id=r.id; END IF;
  RETURN e.id;
END $$;

CREATE OR REPLACE FUNCTION public.vsla_v12_create_digital_loan_payout_intent(
  p_loan_id uuid,p_provider text,p_idempotency_key uuid DEFAULT gen_random_uuid()
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE l public.vsla_v12_loans%ROWTYPE; v_org uuid; v_intent uuid; v_reference text;
BEGIN
  SELECT organization_id INTO v_org FROM public.staff WHERE id=auth.uid();
  IF v_org IS NULL OR NOT public.vsla_v12_actor_has_role(v_org,NULL,ARRAY['chairperson','treasurer']) THEN RAISE EXCEPTION 'Your VSLA role cannot create a digital loan payout'; END IF;
  IF nullif(trim(coalesce(p_provider,'')),'') IS NULL THEN RAISE EXCEPTION 'A BOAT Pay provider is required for a digital loan payout'; END IF;
  SELECT * INTO l FROM public.vsla_v12_loans WHERE id=p_loan_id FOR UPDATE;
  IF NOT FOUND OR l.organization_id<>v_org OR l.status<>'approved_pending_payout' OR l.disbursement_channel<>'mobile_money' THEN RAISE EXCEPTION 'Approved digital loan payout was not found'; END IF;
  SELECT id INTO v_intent FROM public.boat_pay_payment_intents WHERE organization_id=v_org AND idempotency_key=p_idempotency_key; IF v_intent IS NOT NULL THEN RETURN v_intent; END IF;
  IF EXISTS(SELECT 1 FROM public.boat_pay_payment_intents WHERE loan_id=l.id AND purpose='loan_disbursement' AND status NOT IN ('failed','reversed','refunded','cancelled')) THEN RAISE EXCEPTION 'An active payout request already exists for this approved loan'; END IF;
  v_reference:='VSLAPAY-'||replace(p_idempotency_key::text,'-','');
  INSERT INTO public.boat_pay_payment_intents(organization_id,module_code,purpose,member_id,loan_id,provider,channel,provider_reference,idempotency_key,amount,metadata,created_by)
  VALUES(v_org,'vsla','loan_disbursement',l.member_id,l.id,lower(trim(p_provider)),'mobile_money',v_reference,p_idempotency_key,l.principal_amount,jsonb_build_object('loan_disbursement_event_id',l.disbursement_event_id),auth.uid()) RETURNING id INTO v_intent;
  INSERT INTO public.vsla_audit_events(organization_id,actor_id,action,entity,entity_id,after_data) VALUES(v_org,auth.uid(),'boat_pay_loan_payout_intent_created','boat_pay_payment_intents',v_intent,jsonb_build_object('loan_id',l.id,'amount',l.principal_amount,'reference',v_reference));
  RETURN v_intent;
END $$;

CREATE OR REPLACE FUNCTION public.vsla_v12_finalize_digital_loan_disbursement(p_intent_id uuid,p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE i public.boat_pay_payment_intents%ROWTYPE; pe public.boat_pay_payment_events%ROWTYPE; l public.vsla_v12_loans%ROWTYPE; e public.vsla_financial_events%ROWTYPE; v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.staff WHERE id=auth.uid();
  IF v_org IS NULL OR NOT public.vsla_v12_actor_has_role(v_org,NULL,ARRAY['chairperson','treasurer']) THEN RAISE EXCEPTION 'Your VSLA role cannot finalize a digital loan payout'; END IF;
  SELECT * INTO i FROM public.boat_pay_payment_intents WHERE id=p_intent_id FOR UPDATE;
  IF NOT FOUND OR i.organization_id<>v_org OR i.purpose<>'loan_disbursement' THEN RAISE EXCEPTION 'Digital loan payout request was not found'; END IF;
  IF i.status='settled' AND i.settlement_event_id IS NOT NULL THEN RETURN i.settlement_event_id; END IF;
  IF i.status<>'matched' THEN RAISE EXCEPTION 'A matched provider payout is required before loan disbursement'; END IF;
  SELECT * INTO pe FROM public.boat_pay_payment_events WHERE payment_intent_id=i.id AND status='matched' FOR UPDATE;
  IF NOT FOUND OR pe.direction<>'outgoing' OR pe.matched_by IS NULL OR pe.matched_by=auth.uid() THEN RAISE EXCEPTION 'A separately matched outgoing provider payout is required'; END IF;
  SELECT * INTO l FROM public.vsla_v12_loans WHERE id=i.loan_id FOR UPDATE;
  SELECT * INTO e FROM public.vsla_financial_events WHERE id=l.disbursement_event_id FOR UPDATE;
  IF NOT FOUND OR l.status<>'approved_pending_payout' OR l.disbursement_channel<>'mobile_money' OR i.amount<>l.principal_amount OR e.status<>'approved_pending_settlement' THEN RAISE EXCEPTION 'Loan payout no longer matches its approved pending disbursement'; END IF;
  UPDATE public.vsla_financial_events SET status='posted',posted_at=now() WHERE id=e.id;
  UPDATE public.vsla_v12_loans SET status='disbursed',disbursed_at=now() WHERE id=l.id;
  UPDATE public.boat_pay_payment_events SET status='settled',reconciliation_note=coalesce(nullif(trim(coalesce(p_note,'')),''),reconciliation_note) WHERE id=pe.id;
  UPDATE public.boat_pay_payment_intents SET status='settled',settlement_event_id=e.id,settled_at=now(),settled_by=auth.uid() WHERE id=i.id;
  INSERT INTO public.vsla_audit_events(organization_id,actor_id,action,entity,entity_id,after_data,reason) VALUES(v_org,auth.uid(),'boat_pay_loan_payout_finalized','boat_pay_payment_intents',i.id,jsonb_build_object('loan_id',l.id,'payment_event_id',pe.id,'ledger_event_id',e.id),nullif(trim(coalesce(p_note,'')),''));
  RETURN e.id;
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
 IF EXISTS(SELECT 1 FROM public.vsla_v12_loans WHERE request_meeting_id=p_meeting_id AND status='approved_pending_payout') THEN RAISE EXCEPTION 'Resolve approved digital loan payouts before closing the meeting'; END IF;
 IF nullif(trim(coalesce(p_notes,'')),'') IS NULL OR nullif(trim(coalesce(p_chair_name,'')),'') IS NULL OR nullif(trim(coalesce(p_secretary_name,'')),'') IS NULL THEN RAISE EXCEPTION 'Meeting notes, chairperson, and secretary confirmations are required'; END IF;
 PERFORM public.vsla_save_structured_minutes(p_meeting_id,p_notes,jsonb_build_array(jsonb_build_object('item','v1.2 guided meeting')), '[]'::jsonb, jsonb_build_array(jsonb_build_object('name',p_chair_name,'confirmed',true),jsonb_build_object('name',p_secretary_name,'confirmed',true)),1,v_present,true);
 UPDATE public.vsla_meetings SET completed_steps=ARRAY['attendance','savings','loans','repayments','cash'],status='closed' WHERE id=p_meeting_id;
 INSERT INTO public.vsla_audit_events(organization_id,actor_id,action,entity,entity_id,after_data) VALUES(v_org,auth.uid(),'meeting_closed','vsla_meetings',p_meeting_id,jsonb_build_object('attendance',v_present));
END $$;

REVOKE ALL ON FUNCTION public.vsla_v12_request_digital_loan(uuid,uuid,numeric,numeric,integer,uuid),public.vsla_v12_create_digital_loan_payout_intent(uuid,text,uuid),public.vsla_v12_finalize_digital_loan_disbursement(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vsla_v12_request_digital_loan(uuid,uuid,numeric,numeric,integer,uuid),public.vsla_v12_create_digital_loan_payout_intent(uuid,text,uuid),public.vsla_v12_finalize_digital_loan_disbursement(uuid,text) TO authenticated;
