-- Phase 4: BOAT Pay evidence and matching foundation. Provider callbacks remain
-- separate from ledger posting; matching a payment never posts a VSLA event.
CREATE TABLE IF NOT EXISTS public.boat_pay_payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  module_code text NOT NULL DEFAULT 'vsla',
  purpose text NOT NULL CHECK (purpose IN ('savings','loan_repayment','loan_disbursement','expense','shareout_payout')),
  member_id uuid REFERENCES public.vsla_members(id) ON DELETE RESTRICT,
  meeting_id uuid REFERENCES public.vsla_meetings(id) ON DELETE RESTRICT,
  loan_id uuid REFERENCES public.vsla_v12_loans(id) ON DELETE RESTRICT,
  shareout_id uuid REFERENCES public.vsla_v12_shareouts(id) ON DELETE RESTRICT,
  provider text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('mobile_money','bank','wallet')),
  provider_reference text NOT NULL,
  idempotency_key uuid NOT NULL,
  amount numeric(15,2) NOT NULL CHECK (amount>0),
  currency text NOT NULL DEFAULT 'UGX' CHECK (char_length(currency)=3),
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created','provider_pending','provider_confirmed','matched','settled','failed','reversed','refunded','cancelled')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES public.staff(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,idempotency_key),
  UNIQUE(organization_id,provider_reference)
);

CREATE TABLE IF NOT EXISTS public.boat_pay_payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  module_code text NOT NULL DEFAULT 'vsla',
  provider text NOT NULL,
  provider_reference text NOT NULL,
  provider_transaction_id text,
  channel text NOT NULL CHECK (channel IN ('mobile_money','bank','wallet')),
  direction text NOT NULL CHECK (direction IN ('incoming','outgoing')),
  amount numeric(15,2) NOT NULL CHECK (amount>0),
  currency text NOT NULL DEFAULT 'UGX' CHECK (char_length(currency)=3),
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','verified','matched','unmatched','failed','reversed','refunded')),
  occurred_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  payment_intent_id uuid REFERENCES public.boat_pay_payment_intents(id) ON DELETE RESTRICT,
  failure_reason text,
  reconciliation_note text,
  provider_payload_digest text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,provider_reference)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_boat_pay_matched_event_per_intent ON public.boat_pay_payment_events(payment_intent_id) WHERE payment_intent_id IS NOT NULL AND status='matched';
CREATE INDEX IF NOT EXISTS idx_boat_pay_intents_org_status ON public.boat_pay_payment_intents(organization_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_boat_pay_events_org_status ON public.boat_pay_payment_events(organization_id,status,received_at DESC);

CREATE OR REPLACE FUNCTION public.boat_pay_touch_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_boat_pay_intents_touch ON public.boat_pay_payment_intents;
CREATE TRIGGER trg_boat_pay_intents_touch BEFORE UPDATE ON public.boat_pay_payment_intents FOR EACH ROW EXECUTE FUNCTION public.boat_pay_touch_updated_at();
DROP TRIGGER IF EXISTS trg_boat_pay_events_touch ON public.boat_pay_payment_events;
CREATE TRIGGER trg_boat_pay_events_touch BEFORE UPDATE ON public.boat_pay_payment_events FOR EACH ROW EXECUTE FUNCTION public.boat_pay_touch_updated_at();

ALTER TABLE public.boat_pay_payment_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boat_pay_payment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY boat_pay_intents_read ON public.boat_pay_payment_intents FOR SELECT TO authenticated USING(public.is_platform_admin() OR organization_id=public.auth_staff_org_id());
CREATE POLICY boat_pay_events_read ON public.boat_pay_payment_events FOR SELECT TO authenticated USING(public.is_platform_admin() OR organization_id=public.auth_staff_org_id());
REVOKE ALL ON public.boat_pay_payment_intents FROM authenticated;
REVOKE ALL ON public.boat_pay_payment_events FROM authenticated;
GRANT SELECT ON public.boat_pay_payment_intents TO authenticated;
GRANT SELECT ON public.boat_pay_payment_events TO authenticated;

CREATE OR REPLACE FUNCTION public.vsla_v12_create_boat_pay_intent(
  p_purpose text,p_amount numeric,p_provider text,p_channel text,p_member_id uuid DEFAULT NULL,p_meeting_id uuid DEFAULT NULL,p_loan_id uuid DEFAULT NULL,p_shareout_id uuid DEFAULT NULL,p_idempotency_key uuid DEFAULT gen_random_uuid(),p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid; v_intent uuid; v_reference text;
BEGIN
  SELECT organization_id INTO v_org FROM public.staff WHERE id=auth.uid();
  IF v_org IS NULL OR NOT EXISTS(SELECT 1 FROM public.vsla_workflow_settings WHERE organization_id=v_org AND workflow_version='v1_2') THEN RAISE EXCEPTION 'VSLA v1.2 is not enabled for this organization'; END IF;
  IF NOT public.vsla_v12_actor_has_role(v_org,NULL,ARRAY['chairperson','treasurer','secretary']) THEN RAISE EXCEPTION 'Your VSLA role cannot create a BOAT Pay request'; END IF;
  IF p_purpose NOT IN ('savings','loan_repayment','loan_disbursement','expense','shareout_payout') OR p_amount<=0 OR nullif(trim(coalesce(p_provider,'')),'') IS NULL OR p_channel NOT IN ('mobile_money','bank','wallet') THEN RAISE EXCEPTION 'Payment request values are invalid'; END IF;
  IF p_member_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vsla_members WHERE id=p_member_id AND organization_id=v_org) THEN RAISE EXCEPTION 'Payment member was not found in this group'; END IF;
  IF p_meeting_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vsla_meetings WHERE id=p_meeting_id AND organization_id=v_org) THEN RAISE EXCEPTION 'Payment meeting was not found in this group'; END IF;
  IF p_loan_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vsla_v12_loans WHERE id=p_loan_id AND organization_id=v_org) THEN RAISE EXCEPTION 'Payment loan was not found in this group'; END IF;
  IF p_shareout_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vsla_v12_shareouts WHERE id=p_shareout_id AND organization_id=v_org) THEN RAISE EXCEPTION 'Payment share-out was not found in this group'; END IF;
  IF (p_purpose='savings' AND (p_member_id IS NULL OR p_meeting_id IS NULL)) OR (p_purpose='loan_repayment' AND (p_loan_id IS NULL OR p_meeting_id IS NULL)) OR (p_purpose='loan_disbursement' AND p_loan_id IS NULL) OR (p_purpose='shareout_payout' AND (p_member_id IS NULL OR p_shareout_id IS NULL)) THEN RAISE EXCEPTION 'Payment request is missing its controlled VSLA record'; END IF;
  SELECT id INTO v_intent FROM public.boat_pay_payment_intents WHERE organization_id=v_org AND idempotency_key=p_idempotency_key;
  IF v_intent IS NOT NULL THEN RETURN v_intent; END IF;
  v_reference:='VSLAPAY-'||replace(p_idempotency_key::text,'-','');
  INSERT INTO public.boat_pay_payment_intents(organization_id,module_code,purpose,member_id,meeting_id,loan_id,shareout_id,provider,channel,provider_reference,idempotency_key,amount,metadata,created_by)
  VALUES(v_org,'vsla',p_purpose,p_member_id,p_meeting_id,p_loan_id,p_shareout_id,lower(trim(p_provider)),p_channel,v_reference,p_idempotency_key,p_amount,coalesce(p_metadata,'{}'::jsonb),auth.uid()) RETURNING id INTO v_intent;
  INSERT INTO public.vsla_audit_events(organization_id,actor_id,action,entity,entity_id,after_data,reason)
  VALUES(v_org,auth.uid(),'boat_pay_intent_created','boat_pay_payment_intents',v_intent,jsonb_build_object('purpose',p_purpose,'amount',p_amount,'reference',v_reference),NULL);
  RETURN v_intent;
END $$;

CREATE OR REPLACE FUNCTION public.boat_pay_record_payment_event(
  p_organization_id uuid,p_provider text,p_provider_reference text,p_provider_transaction_id text,p_channel text,p_direction text,p_amount numeric,p_currency text,p_status text,p_occurred_at timestamptz DEFAULT NULL,p_failure_reason text DEFAULT NULL,p_payload_digest text DEFAULT NULL,p_module_code text DEFAULT 'vsla'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_event uuid;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Only trusted payment services can record provider events'; END IF;
  IF p_organization_id IS NULL OR nullif(trim(coalesce(p_module_code,'')),'') IS NULL OR nullif(trim(coalesce(p_provider,'')),'') IS NULL OR nullif(trim(coalesce(p_provider_reference,'')),'') IS NULL OR p_channel NOT IN ('mobile_money','bank','wallet') OR p_direction NOT IN ('incoming','outgoing') OR p_status NOT IN ('received','verified','failed','reversed','refunded') OR p_amount<=0 OR upper(coalesce(p_currency,'')) !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Payment provider event values are invalid'; END IF;
  INSERT INTO public.boat_pay_payment_events(organization_id,module_code,provider,provider_reference,provider_transaction_id,channel,direction,amount,currency,status,occurred_at,failure_reason,provider_payload_digest)
  VALUES(p_organization_id,lower(trim(coalesce(p_module_code,'vsla'))),lower(trim(p_provider)),trim(p_provider_reference),nullif(trim(coalesce(p_provider_transaction_id,'')),''),p_channel,p_direction,p_amount,upper(p_currency),p_status,p_occurred_at,p_failure_reason,p_payload_digest)
  ON CONFLICT(provider,provider_reference) DO UPDATE SET provider_transaction_id=EXCLUDED.provider_transaction_id,status=EXCLUDED.status,occurred_at=COALESCE(EXCLUDED.occurred_at,boat_pay_payment_events.occurred_at),failure_reason=EXCLUDED.failure_reason,provider_payload_digest=EXCLUDED.provider_payload_digest
  RETURNING id INTO v_event;
  RETURN v_event;
END $$;

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
  IF e.provider<>i.provider OR e.provider_reference<>i.provider_reference OR e.amount<>i.amount OR e.currency<>i.currency OR e.direction<>(CASE WHEN i.purpose IN ('loan_disbursement','shareout_payout') THEN 'outgoing' ELSE 'incoming' END) THEN RAISE EXCEPTION 'Payment provider, reference, amount, currency, or direction does not match the intent'; END IF;
  UPDATE public.boat_pay_payment_events SET status='matched',payment_intent_id=i.id,reconciliation_note=nullif(trim(coalesce(p_note,'')),'') WHERE id=e.id;
  UPDATE public.boat_pay_payment_intents SET status='matched' WHERE id=i.id;
  INSERT INTO public.vsla_audit_events(organization_id,actor_id,action,entity,entity_id,before_data,after_data,reason)
  VALUES(i.organization_id,auth.uid(),'boat_pay_event_matched','boat_pay_payment_events',e.id,jsonb_build_object('status',e.status),jsonb_build_object('intent_id',i.id,'status','matched'),nullif(trim(coalesce(p_note,'')),''));
END $$;

REVOKE ALL ON FUNCTION public.vsla_v12_create_boat_pay_intent(text,numeric,text,text,uuid,uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.boat_pay_record_payment_event(uuid,text,text,text,text,text,numeric,text,text,timestamptz,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vsla_v12_match_boat_pay_event(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vsla_v12_create_boat_pay_intent(text,numeric,text,text,uuid,uuid,uuid,uuid,uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.boat_pay_record_payment_event(uuid,text,text,text,text,text,numeric,text,text,timestamptz,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.vsla_v12_match_boat_pay_event(uuid,uuid,text) TO authenticated;
