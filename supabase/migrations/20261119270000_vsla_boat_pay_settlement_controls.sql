-- Phase 4: settle only independently reviewed, matched incoming receipts.
-- A provider callback alone never posts a VSLA ledger event.
ALTER TABLE public.boat_pay_payment_intents
  ADD COLUMN IF NOT EXISTS settlement_event_id uuid REFERENCES public.vsla_financial_events(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS settled_at timestamptz,
  ADD COLUMN IF NOT EXISTS settled_by uuid REFERENCES public.staff(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_boat_pay_intent_settlement_event ON public.boat_pay_payment_intents(settlement_event_id) WHERE settlement_event_id IS NOT NULL;

ALTER TABLE public.boat_pay_payment_events
  ADD COLUMN IF NOT EXISTS matched_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS matched_at timestamptz;

ALTER TABLE public.boat_pay_payment_events DROP CONSTRAINT IF EXISTS boat_pay_payment_events_status_check;
ALTER TABLE public.boat_pay_payment_events ADD CONSTRAINT boat_pay_payment_events_status_check
  CHECK (status IN ('received','verified','matched','settled','unmatched','failed','reversed','refunded'));

-- Expenses, just like loans and share-out payments, are outgoing instructions.
CREATE OR REPLACE FUNCTION public.vsla_v12_match_boat_pay_event(p_event_id uuid,p_intent_id uuid,p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e public.boat_pay_payment_events%ROWTYPE; i public.boat_pay_payment_intents%ROWTYPE; v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.staff WHERE id=auth.uid();
  IF v_org IS NULL OR NOT public.vsla_v12_actor_has_role(v_org,NULL,ARRAY['chairperson','treasurer','secretary']) THEN RAISE EXCEPTION 'Your VSLA role cannot reconcile BOAT Pay events'; END IF;
  SELECT * INTO e FROM public.boat_pay_payment_events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment event was not found'; END IF;
  SELECT * INTO i FROM public.boat_pay_payment_intents WHERE id=p_intent_id FOR UPDATE;
  IF NOT FOUND OR e.organization_id<>i.organization_id OR i.organization_id<>v_org THEN RAISE EXCEPTION 'Payment event or intent was not found'; END IF;
  IF e.status NOT IN ('received','verified','unmatched') OR i.status NOT IN ('created','provider_pending','provider_confirmed') THEN RAISE EXCEPTION 'Payment event or intent is not eligible for matching'; END IF;
  IF e.provider<>i.provider OR e.provider_reference<>i.provider_reference OR e.amount<>i.amount OR e.currency<>i.currency OR e.direction<>(CASE WHEN i.purpose IN ('loan_disbursement','expense','shareout_payout') THEN 'outgoing' ELSE 'incoming' END) THEN RAISE EXCEPTION 'Payment provider, reference, amount, currency, or direction does not match the intent'; END IF;
  UPDATE public.boat_pay_payment_events SET status='matched',payment_intent_id=i.id,reconciliation_note=nullif(trim(coalesce(p_note,'')),''),matched_by=auth.uid(),matched_at=now() WHERE id=e.id;
  UPDATE public.boat_pay_payment_intents SET status='matched' WHERE id=i.id;
  INSERT INTO public.vsla_audit_events(organization_id,actor_id,action,entity,entity_id,before_data,after_data,reason)
  VALUES(i.organization_id,auth.uid(),'boat_pay_event_matched','boat_pay_payment_events',e.id,jsonb_build_object('status',e.status),jsonb_build_object('intent_id',i.id,'status','matched'),nullif(trim(coalesce(p_note,'')),''));
END $$;

CREATE OR REPLACE FUNCTION public.vsla_v12_settle_boat_pay_receipt(
  p_intent_id uuid,
  p_note text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  i public.boat_pay_payment_intents%ROWTYPE;
  e public.boat_pay_payment_events%ROWTYPE;
  v_org uuid;
  v_share_value numeric;
  v_shares integer;
  v_ledger_event uuid;
  v_ledger public.vsla_financial_events%ROWTYPE;
BEGIN
  SELECT organization_id INTO v_org FROM public.staff WHERE id=auth.uid();
  IF v_org IS NULL OR NOT EXISTS(SELECT 1 FROM public.vsla_workflow_settings WHERE organization_id=v_org AND workflow_version='v1_2') THEN RAISE EXCEPTION 'VSLA v1.2 is not enabled for this organization'; END IF;
  IF NOT public.vsla_v12_actor_has_role(v_org,NULL,ARRAY['chairperson','treasurer']) THEN RAISE EXCEPTION 'Your VSLA role cannot settle BOAT Pay receipts'; END IF;

  SELECT * INTO i FROM public.boat_pay_payment_intents WHERE id=p_intent_id FOR UPDATE;
  IF NOT FOUND OR i.organization_id<>v_org THEN RAISE EXCEPTION 'Payment request was not found'; END IF;
  IF i.status='settled' AND i.settlement_event_id IS NOT NULL THEN RETURN i.settlement_event_id; END IF;
  IF i.status<>'matched' OR i.purpose NOT IN ('savings','loan_repayment') THEN RAISE EXCEPTION 'Only matched savings and loan repayment receipts can be settled'; END IF;

  SELECT * INTO e FROM public.boat_pay_payment_events
  WHERE payment_intent_id=i.id AND status='matched' FOR UPDATE;
  IF NOT FOUND OR e.direction<>'incoming' THEN RAISE EXCEPTION 'A matched incoming provider receipt is required before settlement'; END IF;
  IF e.matched_by IS NULL OR e.matched_by=auth.uid() THEN RAISE EXCEPTION 'A different authorized staff member must settle this independently matched receipt'; END IF;

  IF i.purpose='savings' THEN
    IF i.member_id IS NULL OR i.meeting_id IS NULL THEN RAISE EXCEPTION 'Savings receipt is missing its member or meeting'; END IF;
    SELECT share_value INTO v_share_value FROM public.vsla_settings WHERE organization_id=v_org;
    IF v_share_value IS NULL OR v_share_value<=0 OR mod(i.amount,v_share_value)<>0 THEN RAISE EXCEPTION 'Savings receipt amount must equal a whole number of configured shares'; END IF;
    v_shares:=(i.amount/v_share_value)::integer;
    v_ledger_event:=public.vsla_v12_receive_savings(i.meeting_id,i.member_id,v_shares,i.idempotency_key);
  ELSE
    IF i.loan_id IS NULL OR i.meeting_id IS NULL THEN RAISE EXCEPTION 'Loan repayment receipt is missing its loan or meeting'; END IF;
    v_ledger_event:=public.vsla_v12_receive_loan_repayment(i.meeting_id,i.loan_id,i.amount,i.idempotency_key);
  END IF;

  SELECT * INTO v_ledger FROM public.vsla_financial_events WHERE id=v_ledger_event FOR UPDATE;
  IF NOT FOUND OR v_ledger.organization_id<>v_org OR v_ledger.status<>'posted' OR v_ledger.event_type<>(CASE WHEN i.purpose='savings' THEN 'savings_received' ELSE 'loan_repayment' END) OR v_ledger.amount<>i.amount OR (i.member_id IS NOT NULL AND v_ledger.member_id<>i.member_id) THEN RAISE EXCEPTION 'The resulting VSLA ledger event did not pass payment settlement validation'; END IF;

  UPDATE public.boat_pay_payment_events SET status='settled',reconciliation_note=coalesce(nullif(trim(coalesce(p_note,'')),''),reconciliation_note) WHERE id=e.id;
  UPDATE public.boat_pay_payment_intents SET status='settled',settlement_event_id=v_ledger_event,settled_by=auth.uid(),settled_at=now() WHERE id=i.id;
  INSERT INTO public.vsla_audit_events(organization_id,actor_id,action,entity,entity_id,after_data,reason)
  VALUES(v_org,auth.uid(),'boat_pay_receipt_settled','boat_pay_payment_intents',i.id,jsonb_build_object('payment_event_id',e.id,'ledger_event_id',v_ledger_event,'purpose',i.purpose,'amount',i.amount),nullif(trim(coalesce(p_note,'')),''));
  RETURN v_ledger_event;
END $$;

REVOKE ALL ON FUNCTION public.vsla_v12_match_boat_pay_event(uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vsla_v12_settle_boat_pay_receipt(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vsla_v12_match_boat_pay_event(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vsla_v12_settle_boat_pay_receipt(uuid,text) TO authenticated;
