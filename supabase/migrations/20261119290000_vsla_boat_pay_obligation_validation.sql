-- Phase 4: payment requests must never exceed the controlled VSLA obligation
-- they describe. These checks apply before any provider adapter is allowed to send.
CREATE UNIQUE INDEX IF NOT EXISTS uq_boat_pay_active_loan_disbursement
  ON public.boat_pay_payment_intents(loan_id)
  WHERE purpose='loan_disbursement' AND status NOT IN ('failed','reversed','refunded','cancelled');
CREATE UNIQUE INDEX IF NOT EXISTS uq_boat_pay_active_shareout_payout
  ON public.boat_pay_payment_intents(shareout_id,member_id)
  WHERE purpose='shareout_payout' AND status NOT IN ('failed','reversed','refunded','cancelled');

CREATE OR REPLACE FUNCTION public.vsla_v12_create_boat_pay_intent(
  p_purpose text,p_amount numeric,p_provider text,p_channel text,p_member_id uuid DEFAULT NULL,p_meeting_id uuid DEFAULT NULL,p_loan_id uuid DEFAULT NULL,p_shareout_id uuid DEFAULT NULL,p_idempotency_key uuid DEFAULT gen_random_uuid(),p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid; v_intent uuid; v_reference text; v_member uuid:=p_member_id; v_loan public.vsla_v12_loans%ROWTYPE; v_shareout public.vsla_v12_shareouts%ROWTYPE; v_payout numeric; v_expense_event uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.staff WHERE id=auth.uid();
  IF v_org IS NULL OR NOT EXISTS(SELECT 1 FROM public.vsla_workflow_settings WHERE organization_id=v_org AND workflow_version='v1_2') THEN RAISE EXCEPTION 'VSLA v1.2 is not enabled for this organization'; END IF;
  IF NOT public.vsla_v12_actor_has_role(v_org,NULL,ARRAY['chairperson','treasurer','secretary']) THEN RAISE EXCEPTION 'Your VSLA role cannot create a BOAT Pay request'; END IF;
  IF p_purpose NOT IN ('savings','loan_repayment','loan_disbursement','expense','shareout_payout') OR p_amount<=0 OR nullif(trim(coalesce(p_provider,'')),'') IS NULL OR p_channel NOT IN ('mobile_money','bank','wallet') THEN RAISE EXCEPTION 'Payment request values are invalid'; END IF;
  IF p_member_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vsla_members WHERE id=p_member_id AND organization_id=v_org AND status='active') THEN RAISE EXCEPTION 'Payment member was not found as an active member in this group'; END IF;
  IF p_meeting_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vsla_meetings WHERE id=p_meeting_id AND organization_id=v_org) THEN RAISE EXCEPTION 'Payment meeting was not found in this group'; END IF;
  IF p_loan_id IS NOT NULL THEN SELECT * INTO v_loan FROM public.vsla_v12_loans WHERE id=p_loan_id AND organization_id=v_org; IF NOT FOUND THEN RAISE EXCEPTION 'Payment loan was not found in this group'; END IF; END IF;
  IF p_shareout_id IS NOT NULL THEN SELECT * INTO v_shareout FROM public.vsla_v12_shareouts WHERE id=p_shareout_id AND organization_id=v_org; IF NOT FOUND THEN RAISE EXCEPTION 'Payment share-out was not found in this group'; END IF; END IF;
  IF (p_purpose='savings' AND (v_member IS NULL OR p_meeting_id IS NULL)) OR (p_purpose='loan_repayment' AND (p_loan_id IS NULL OR p_meeting_id IS NULL)) OR (p_purpose='loan_disbursement' AND p_loan_id IS NULL) OR (p_purpose='shareout_payout' AND (v_member IS NULL OR p_shareout_id IS NULL)) THEN RAISE EXCEPTION 'Payment request is missing its controlled VSLA record'; END IF;

  IF p_purpose='savings' AND NOT EXISTS(SELECT 1 FROM public.vsla_meetings WHERE id=p_meeting_id AND organization_id=v_org AND status='open') THEN RAISE EXCEPTION 'Savings payments can only be requested for an open meeting'; END IF;
  IF p_purpose='loan_repayment' THEN
    IF v_member IS NOT NULL AND v_member<>v_loan.member_id THEN RAISE EXCEPTION 'Loan repayment member does not match the controlled loan'; END IF;
    v_member:=v_loan.member_id;
    IF v_loan.status<>'disbursed' OR p_amount>v_loan.outstanding_balance THEN RAISE EXCEPTION 'Loan repayment cannot exceed the approved outstanding balance'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.vsla_meetings WHERE id=p_meeting_id AND organization_id=v_org AND status='open') THEN RAISE EXCEPTION 'Loan repayment payments can only be requested for an open meeting'; END IF;
  ELSIF p_purpose='loan_disbursement' THEN
    IF v_member IS NOT NULL AND v_member<>v_loan.member_id THEN RAISE EXCEPTION 'Loan disbursement member does not match the controlled loan'; END IF;
    v_member:=v_loan.member_id;
    IF v_loan.status<>'disbursed' OR p_amount<>v_loan.principal_amount THEN RAISE EXCEPTION 'Digital loan disbursement must equal one approved loan principal'; END IF;
  ELSIF p_purpose='shareout_payout' THEN
    IF v_shareout.status<>'approved' THEN RAISE EXCEPTION 'Share-out payouts require an approved share-out schedule'; END IF;
    SELECT (entry->>'payout_amount')::numeric INTO v_payout FROM jsonb_array_elements(v_shareout.payout_schedule) AS entry WHERE (entry->>'member_id')::uuid=v_member;
    IF v_payout IS NULL OR p_amount<>v_payout THEN RAISE EXCEPTION 'Share-out payout must equal the approved member entitlement'; END IF;
  ELSIF p_purpose='expense' THEN
    IF coalesce(p_metadata->>'expense_event_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN RAISE EXCEPTION 'Expense payment requires an approved expense event reference'; END IF;
    v_expense_event:=(p_metadata->>'expense_event_id')::uuid;
    IF NOT EXISTS(SELECT 1 FROM public.vsla_financial_events WHERE id=v_expense_event AND organization_id=v_org AND event_type='expense_paid' AND status='posted' AND amount=p_amount) THEN RAISE EXCEPTION 'Expense payment must match one approved posted expense'; END IF;
  END IF;

  SELECT id INTO v_intent FROM public.boat_pay_payment_intents WHERE organization_id=v_org AND idempotency_key=p_idempotency_key;
  IF v_intent IS NOT NULL THEN RETURN v_intent; END IF;
  v_reference:='VSLAPAY-'||replace(p_idempotency_key::text,'-','');
  INSERT INTO public.boat_pay_payment_intents(organization_id,module_code,purpose,member_id,meeting_id,loan_id,shareout_id,provider,channel,provider_reference,idempotency_key,amount,metadata,created_by)
  VALUES(v_org,'vsla',p_purpose,v_member,p_meeting_id,p_loan_id,p_shareout_id,lower(trim(p_provider)),p_channel,v_reference,p_idempotency_key,p_amount,coalesce(p_metadata,'{}'::jsonb),auth.uid()) RETURNING id INTO v_intent;
  INSERT INTO public.vsla_audit_events(organization_id,actor_id,action,entity,entity_id,after_data,reason)
  VALUES(v_org,auth.uid(),'boat_pay_intent_created','boat_pay_payment_intents',v_intent,jsonb_build_object('purpose',p_purpose,'amount',p_amount,'reference',v_reference,'member_id',v_member),NULL);
  RETURN v_intent;
END $$;

REVOKE ALL ON FUNCTION public.vsla_v12_create_boat_pay_intent(text,numeric,text,text,uuid,uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vsla_v12_create_boat_pay_intent(text,numeric,text,text,uuid,uuid,uuid,uuid,uuid,jsonb) TO authenticated;
