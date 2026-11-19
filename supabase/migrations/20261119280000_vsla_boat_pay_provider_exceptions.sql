-- Phase 4: provider failures, reversals, and refunds must never silently alter
-- a settled VSLA balance. They become an auditable, independently resolved exception.
ALTER TABLE public.boat_pay_payment_intents DROP CONSTRAINT IF EXISTS boat_pay_payment_intents_status_check;
ALTER TABLE public.boat_pay_payment_intents ADD CONSTRAINT boat_pay_payment_intents_status_check
  CHECK (status IN ('created','provider_pending','provider_confirmed','matched','settled','failed','reversed','refunded','reversal_pending','cancelled'));
ALTER TABLE public.boat_pay_payment_intents
  ADD COLUMN IF NOT EXISTS reversal_event_id uuid REFERENCES public.vsla_financial_events(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reversal_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversal_resolved_by uuid REFERENCES public.staff(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_boat_pay_intent_reversal_event ON public.boat_pay_payment_intents(reversal_event_id) WHERE reversal_event_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.boat_pay_record_payment_event(
  p_organization_id uuid,p_provider text,p_provider_reference text,p_provider_transaction_id text,p_channel text,p_direction text,p_amount numeric,p_currency text,p_status text,p_occurred_at timestamptz DEFAULT NULL,p_failure_reason text DEFAULT NULL,p_payload_digest text DEFAULT NULL,p_module_code text DEFAULT 'vsla'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_event public.boat_pay_payment_events%ROWTYPE; v_before jsonb; v_exceptional boolean;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Only trusted payment services can record provider events'; END IF;
  IF p_organization_id IS NULL OR nullif(trim(coalesce(p_module_code,'')),'') IS NULL OR nullif(trim(coalesce(p_provider,'')),'') IS NULL OR nullif(trim(coalesce(p_provider_reference,'')),'') IS NULL OR p_channel NOT IN ('mobile_money','bank','wallet') OR p_direction NOT IN ('incoming','outgoing') OR p_status NOT IN ('received','verified','failed','reversed','refunded') OR p_amount<=0 OR upper(coalesce(p_currency,'')) !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Payment provider event values are invalid'; END IF;

  SELECT * INTO v_event FROM public.boat_pay_payment_events WHERE provider=lower(trim(p_provider)) AND provider_reference=trim(p_provider_reference) FOR UPDATE;
  IF FOUND THEN
    IF v_event.organization_id<>p_organization_id OR v_event.module_code<>lower(trim(coalesce(p_module_code,'vsla'))) OR v_event.channel<>p_channel OR v_event.direction<>p_direction OR v_event.amount<>p_amount OR v_event.currency<>upper(p_currency) THEN RAISE EXCEPTION 'Payment provider reference conflicts with existing evidence'; END IF;
    v_before:=to_jsonb(v_event);
    -- Do not allow an older acknowledgement to move a matched or settled receipt backwards.
    IF v_event.status IN ('matched','settled') AND p_status IN ('received','verified') THEN
      UPDATE public.boat_pay_payment_events SET provider_transaction_id=coalesce(nullif(trim(coalesce(p_provider_transaction_id,'')),''),provider_transaction_id),occurred_at=coalesce(p_occurred_at,occurred_at),provider_payload_digest=coalesce(p_payload_digest,provider_payload_digest) WHERE id=v_event.id RETURNING * INTO v_event;
    ELSE
      UPDATE public.boat_pay_payment_events SET provider_transaction_id=coalesce(nullif(trim(coalesce(p_provider_transaction_id,'')),''),provider_transaction_id),status=p_status,occurred_at=coalesce(p_occurred_at,occurred_at),failure_reason=p_failure_reason,provider_payload_digest=coalesce(p_payload_digest,provider_payload_digest) WHERE id=v_event.id RETURNING * INTO v_event;
    END IF;
  ELSE
    INSERT INTO public.boat_pay_payment_events(organization_id,module_code,provider,provider_reference,provider_transaction_id,channel,direction,amount,currency,status,occurred_at,failure_reason,provider_payload_digest)
    VALUES(p_organization_id,lower(trim(coalesce(p_module_code,'vsla'))),lower(trim(p_provider)),trim(p_provider_reference),nullif(trim(coalesce(p_provider_transaction_id,'')),''),p_channel,p_direction,p_amount,upper(p_currency),p_status,p_occurred_at,p_failure_reason,p_payload_digest)
    RETURNING * INTO v_event;
  END IF;

  v_exceptional:=v_event.status IN ('failed','reversed','refunded');
  IF v_event.payment_intent_id IS NOT NULL THEN
    IF v_exceptional AND EXISTS(SELECT 1 FROM public.boat_pay_payment_intents WHERE id=v_event.payment_intent_id AND status='settled') THEN
      UPDATE public.boat_pay_payment_intents SET status='reversal_pending' WHERE id=v_event.payment_intent_id;
    ELSIF v_exceptional THEN
      UPDATE public.boat_pay_payment_intents SET status=v_event.status WHERE id=v_event.payment_intent_id AND status IN ('created','provider_pending','provider_confirmed','matched');
    END IF;
  END IF;
  INSERT INTO public.vsla_audit_events(organization_id,actor_id,action,entity,entity_id,before_data,after_data,reason)
  VALUES(v_event.organization_id,auth.uid(),CASE WHEN v_before IS NULL THEN 'boat_pay_provider_event_received' ELSE 'boat_pay_provider_event_updated' END,'boat_pay_payment_events',v_event.id,v_before,to_jsonb(v_event),nullif(trim(coalesce(p_failure_reason,'')),''));
  RETURN v_event.id;
END $$;

CREATE OR REPLACE FUNCTION public.vsla_v12_resolve_boat_pay_receipt_reversal(
  p_intent_id uuid,
  p_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE i public.boat_pay_payment_intents%ROWTYPE; e public.boat_pay_payment_events%ROWTYPE; v_org uuid; v_reversal uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.staff WHERE id=auth.uid();
  IF v_org IS NULL OR NOT public.vsla_v12_actor_has_role(v_org,NULL,ARRAY['chairperson','treasurer']) THEN RAISE EXCEPTION 'Your VSLA role cannot resolve BOAT Pay reversals'; END IF;
  IF nullif(trim(coalesce(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'A provider reversal resolution reason is required'; END IF;
  SELECT * INTO i FROM public.boat_pay_payment_intents WHERE id=p_intent_id FOR UPDATE;
  IF NOT FOUND OR i.organization_id<>v_org OR i.status<>'reversal_pending' OR i.settlement_event_id IS NULL THEN RAISE EXCEPTION 'No settled provider reversal is awaiting resolution for this payment request'; END IF;
  IF i.settled_by IS NULL OR i.settled_by=auth.uid() THEN RAISE EXCEPTION 'A different authorized staff member must resolve a settled payment reversal'; END IF;
  SELECT * INTO e FROM public.boat_pay_payment_events WHERE payment_intent_id=i.id AND status IN ('failed','reversed','refunded') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Confirmed provider failure, reversal, or refund evidence is required'; END IF;
  IF i.reversal_event_id IS NOT NULL THEN RETURN i.reversal_event_id; END IF;
  v_reversal:=public.vsla_v12_reverse_financial_event(i.settlement_event_id,gen_random_uuid(),'V12-PAY-REV-'||replace(i.provider_reference,' ','-'),trim(p_reason));
  UPDATE public.boat_pay_payment_intents SET status=CASE WHEN e.status='refunded' THEN 'refunded' ELSE 'reversed' END,reversal_event_id=v_reversal,reversal_resolved_by=auth.uid(),reversal_resolved_at=now() WHERE id=i.id;
  INSERT INTO public.vsla_audit_events(organization_id,actor_id,action,entity,entity_id,after_data,reason)
  VALUES(v_org,auth.uid(),'boat_pay_receipt_reversal_resolved','boat_pay_payment_intents',i.id,jsonb_build_object('payment_event_id',e.id,'settlement_event_id',i.settlement_event_id,'reversal_event_id',v_reversal,'provider_status',e.status),trim(p_reason));
  RETURN v_reversal;
END $$;

REVOKE ALL ON FUNCTION public.boat_pay_record_payment_event(uuid,text,text,text,text,text,numeric,text,text,timestamptz,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vsla_v12_resolve_boat_pay_receipt_reversal(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.boat_pay_record_payment_event(uuid,text,text,text,text,text,numeric,text,text,timestamptz,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.vsla_v12_resolve_boat_pay_receipt_reversal(uuid,text) TO authenticated;
