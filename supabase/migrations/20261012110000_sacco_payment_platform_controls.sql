-- SACCO payment platform controls: limits, immutable payment records, risk/dispute
-- evidence and a governed internal mini-app service rail.

ALTER TABLE public.sacco_member_payment_transactions
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'reversed')),
  ADD COLUMN IF NOT EXISTS reversal_of uuid REFERENCES public.sacco_member_payment_transactions(id) ON DELETE RESTRICT;
ALTER TABLE public.sacco_member_payment_transactions
  DROP CONSTRAINT IF EXISTS sacco_member_payment_transactions_payment_kind_check;
ALTER TABLE public.sacco_member_payment_transactions
  ADD CONSTRAINT sacco_member_payment_transactions_payment_kind_check
  CHECK (payment_kind IN ('member_transfer', 'qr_payment', 'mini_app_payment', 'reversal'));

CREATE TABLE IF NOT EXISTS public.sacco_member_payment_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  maximum_transaction_amount numeric(15,2) NOT NULL DEFAULT 2000000 CHECK (maximum_transaction_amount > 0),
  daily_transfer_limit numeric(15,2) NOT NULL DEFAULT 5000000 CHECK (daily_transfer_limit > 0),
  risk_review_amount numeric(15,2) NOT NULL DEFAULT 1000000 CHECK (risk_review_amount > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.staff(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.sacco_member_payment_risk_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payment_transaction_id uuid REFERENCES public.sacco_member_payment_transactions(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.sacco_members(id) ON DELETE SET NULL,
  severity text NOT NULL CHECK (severity IN ('info', 'review', 'high')),
  event_type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.staff(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.sacco_member_payment_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payment_transaction_id uuid NOT NULL REFERENCES public.sacco_member_payment_transactions(id) ON DELETE RESTRICT,
  opened_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'rejected')),
  resolution_note text,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_transaction_id, opened_by)
);

CREATE TABLE IF NOT EXISTS public.sacco_member_payment_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.sacco_members(id) ON DELETE CASCADE,
  payment_transaction_id uuid REFERENCES public.sacco_member_payment_transactions(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sacco_mini_apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  app_key text NOT NULL,
  display_name text NOT NULL,
  description text NOT NULL DEFAULT '',
  icon_key text NOT NULL DEFAULT 'grid',
  settlement_account_id uuid NOT NULL REFERENCES public.sacco_member_savings_accounts(id) ON DELETE RESTRICT,
  minimum_amount numeric(15,2) NOT NULL DEFAULT 1 CHECK (minimum_amount > 0),
  maximum_amount numeric(15,2),
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sacco_mini_apps_org_key UNIQUE (organization_id, app_key),
  CONSTRAINT sacco_mini_apps_amount_range CHECK (maximum_amount IS NULL OR maximum_amount >= minimum_amount)
);

CREATE TABLE IF NOT EXISTS public.sacco_mini_app_payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  mini_app_id uuid NOT NULL REFERENCES public.sacco_mini_apps(id) ON DELETE RESTRICT,
  payer_member_id uuid NOT NULL REFERENCES public.sacco_members(id) ON DELETE RESTRICT,
  qr_intent_id uuid NOT NULL UNIQUE REFERENCES public.sacco_member_payment_qr_intents(id) ON DELETE RESTRICT,
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  service_reference text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired', 'cancelled')),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sacco_payment_risk_open ON public.sacco_member_payment_risk_events(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sacco_payment_disputes_open ON public.sacco_member_payment_disputes(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sacco_mini_apps_active ON public.sacco_mini_apps(organization_id, is_active, display_name);

ALTER TABLE public.sacco_member_payment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_member_payment_risk_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_member_payment_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_member_payment_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_mini_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_mini_app_payment_intents ENABLE ROW LEVEL SECURITY;

CREATE POLICY sacco_member_payment_settings_staff ON public.sacco_member_payment_settings FOR ALL TO authenticated
  USING (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid())) WITH CHECK (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
CREATE POLICY sacco_member_payment_risk_events_staff ON public.sacco_member_payment_risk_events FOR SELECT TO authenticated
  USING (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
CREATE POLICY sacco_member_payment_disputes_staff ON public.sacco_member_payment_disputes FOR SELECT TO authenticated
  USING (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
CREATE POLICY sacco_member_payment_disputes_member ON public.sacco_member_payment_disputes FOR SELECT TO authenticated
  USING (opened_by=auth.uid());
CREATE POLICY sacco_member_payment_notifications_member ON public.sacco_member_payment_notifications FOR SELECT TO authenticated
  USING (member_id=public.current_sacco_member_id());
CREATE POLICY sacco_member_payment_notifications_staff ON public.sacco_member_payment_notifications FOR SELECT TO authenticated
  USING (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
CREATE POLICY sacco_mini_apps_member_read ON public.sacco_mini_apps FOR SELECT TO authenticated
  USING (organization_id=public.current_sacco_member_org_id() AND is_active=true);
CREATE POLICY sacco_mini_apps_staff ON public.sacco_mini_apps FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.staff s WHERE s.id=auth.uid() AND s.organization_id=sacco_mini_apps.organization_id AND lower(coalesce(s.role,'')) IN ('admin','super_admin','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.staff s WHERE s.id=auth.uid() AND s.organization_id=sacco_mini_apps.organization_id AND lower(coalesce(s.role,'')) IN ('admin','super_admin','manager')));
CREATE POLICY sacco_mini_app_payment_intents_member ON public.sacco_mini_app_payment_intents FOR SELECT TO authenticated
  USING (payer_member_id=public.current_sacco_member_id());
CREATE POLICY sacco_mini_app_payment_intents_staff ON public.sacco_mini_app_payment_intents FOR SELECT TO authenticated
  USING (organization_id=(SELECT organization_id FROM public.staff WHERE id=auth.uid()));
GRANT SELECT, INSERT, UPDATE ON public.sacco_member_payment_settings, public.sacco_mini_apps TO authenticated;
GRANT SELECT ON public.sacco_member_payment_risk_events, public.sacco_member_payment_disputes, public.sacco_member_payment_notifications, public.sacco_mini_app_payment_intents TO authenticated;

CREATE OR REPLACE FUNCTION public.sacco_member_payment_transactions_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Member payment records are immutable; use an authorized reversal'; END IF;
  -- A reversal leaves the original financial facts intact and only links the two
  -- immutable records. No member or client RLS policy permits this update.
  IF OLD.status='posted' AND NEW.status='reversed' THEN RETURN NEW; END IF;
  IF OLD.reversal_of IS NULL AND NEW.reversal_of IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Member payment records are immutable; use an authorized reversal'; END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS trg_sacco_member_payment_transactions_immutable ON public.sacco_member_payment_transactions;
CREATE TRIGGER trg_sacco_member_payment_transactions_immutable BEFORE UPDATE OR DELETE ON public.sacco_member_payment_transactions FOR EACH ROW EXECUTE FUNCTION public.sacco_member_payment_transactions_immutable();

-- Replace the posting helper with daily / transaction limits, member notifications, and risk evidence.
CREATE OR REPLACE FUNCTION public.sacco_post_member_payment(
  p_source_account_id uuid, p_destination_account_id uuid, p_amount numeric,
  p_reference text, p_idempotency_key text, p_kind text, p_note text DEFAULT NULL,
  p_qr_intent_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_source public.sacco_member_savings_accounts%ROWTYPE; v_destination public.sacco_member_savings_accounts%ROWTYPE;
  v_source_member public.sacco_members%ROWTYPE; v_destination_member public.sacco_members%ROWTYPE;
  v_settings public.sacco_member_payment_settings%ROWTYPE; v_txn_id uuid; v_from_prev numeric:=0; v_to_prev numeric:=0; v_today_total numeric:=0;
BEGIN
  IF p_amount IS NULL OR p_amount<=0 OR p_amount>100000000 THEN RAISE EXCEPTION 'Enter a valid transfer amount'; END IF;
  IF nullif(trim(coalesce(p_idempotency_key,'')),'') IS NULL THEN RAISE EXCEPTION 'A payment idempotency key is required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(least(p_source_account_id::text,p_destination_account_id::text)));
  PERFORM pg_advisory_xact_lock(hashtext(greatest(p_source_account_id::text,p_destination_account_id::text)));
  SELECT * INTO v_source FROM public.sacco_member_savings_accounts WHERE id=p_source_account_id AND is_active=true FOR UPDATE;
  SELECT * INTO v_destination FROM public.sacco_member_savings_accounts WHERE id=p_destination_account_id AND is_active=true FOR UPDATE;
  IF v_source.id IS NULL OR v_destination.id IS NULL OR v_source.organization_id<>v_destination.organization_id THEN RAISE EXCEPTION 'Savings account not found'; END IF;
  IF v_source.id=v_destination.id THEN RAISE EXCEPTION 'Cannot transfer to the same savings account'; END IF;
  SELECT * INTO v_source_member FROM public.sacco_members WHERE id=v_source.sacco_member_id AND is_active=true;
  SELECT * INTO v_destination_member FROM public.sacco_members WHERE id=v_destination.sacco_member_id AND is_active=true;
  IF v_source_member.id IS NULL OR v_destination_member.id IS NULL THEN RAISE EXCEPTION 'Both members must be active'; END IF;
  SELECT id INTO v_txn_id FROM public.sacco_member_payment_transactions WHERE organization_id=v_source.organization_id AND initiated_by=auth.uid() AND idempotency_key=p_idempotency_key;
  IF v_txn_id IS NOT NULL THEN RETURN v_txn_id; END IF;
  SELECT * INTO v_settings FROM public.sacco_member_payment_settings WHERE organization_id=v_source.organization_id;
  IF NOT FOUND THEN INSERT INTO public.sacco_member_payment_settings(organization_id) VALUES(v_source.organization_id) RETURNING * INTO v_settings; END IF;
  IF p_kind<>'reversal' AND p_amount>v_settings.maximum_transaction_amount THEN RAISE EXCEPTION 'Amount exceeds the per-transaction member payment limit'; END IF;
  SELECT coalesce(sum(amount),0) INTO v_today_total FROM public.sacco_member_payment_transactions WHERE source_member_id=v_source_member.id AND status='posted' AND created_at>=date_trunc('day',now());
  IF p_kind<>'reversal' AND v_today_total+p_amount>v_settings.daily_transfer_limit THEN RAISE EXCEPTION 'Amount exceeds the daily member payment limit'; END IF;
  IF v_source.balance<p_amount THEN RAISE EXCEPTION 'Insufficient available savings balance'; END IF;
  UPDATE public.sacco_member_savings_accounts SET balance=balance-p_amount WHERE id=v_source.id;
  UPDATE public.sacco_member_savings_accounts SET balance=balance+p_amount WHERE id=v_destination.id;
  INSERT INTO public.sacco_member_payment_transactions(organization_id,source_account_id,destination_account_id,source_member_id,destination_member_id,amount,reference,idempotency_key,payment_kind,qr_intent_id,note,initiated_by)
    VALUES(v_source.organization_id,v_source.id,v_destination.id,v_source_member.id,v_destination_member.id,p_amount,p_reference,p_idempotency_key,p_kind,p_qr_intent_id,nullif(trim(coalesce(p_note,'')),''),auth.uid()) RETURNING id INTO v_txn_id;
  SELECT coalesce(balance,0) INTO v_from_prev FROM public.sacco_cashbook_entries WHERE organization_id=v_source.organization_id AND sacco_member_id=v_source_member.id ORDER BY created_at DESC LIMIT 1;
  SELECT coalesce(balance,0) INTO v_to_prev FROM public.sacco_cashbook_entries WHERE organization_id=v_source.organization_id AND sacco_member_id=v_destination_member.id ORDER BY created_at DESC LIMIT 1;
  INSERT INTO public.sacco_cashbook_entries(organization_id,entry_date,description,reference,category,sacco_member_id,member_name,debit,credit,balance) VALUES
    (v_source.organization_id,current_date,'Member payment to '||v_destination_member.member_number,p_reference,'Member payment',v_source_member.id,v_source_member.full_name,0,p_amount,v_from_prev-p_amount),
    (v_source.organization_id,current_date,'Member payment from '||v_source_member.member_number,p_reference,'Member payment',v_destination_member.id,v_destination_member.full_name,p_amount,0,v_to_prev+p_amount);
  INSERT INTO public.sacco_member_payment_notifications(organization_id,member_id,payment_transaction_id,notification_type,title,body) VALUES
    (v_source.organization_id,v_source_member.id,v_txn_id,'payment_sent','Payment sent','You sent '||p_amount||' to member '||v_destination_member.member_number||'.'),
    (v_source.organization_id,v_destination_member.id,v_txn_id,'payment_received','Payment received','You received '||p_amount||' from member '||v_source_member.member_number||'.');
  IF p_amount>=v_settings.risk_review_amount THEN
    INSERT INTO public.sacco_member_payment_risk_events(organization_id,payment_transaction_id,member_id,severity,event_type,details)
      VALUES(v_source.organization_id,v_txn_id,v_source_member.id,'review','high_value_member_payment',jsonb_build_object('amount',p_amount,'daily_total_before',v_today_total));
  END IF;
  RETURN v_txn_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sacco_open_member_payment_dispute(p_payment_transaction_id uuid, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_txn public.sacco_member_payment_transactions%ROWTYPE; v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR public.current_sacco_member_id() IS NULL THEN RAISE EXCEPTION 'Sign in as a SACCO member to report a payment issue'; END IF;
  IF nullif(trim(coalesce(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Describe the payment issue'; END IF;
  SELECT * INTO v_txn FROM public.sacco_member_payment_transactions WHERE id=p_payment_transaction_id;
  IF NOT FOUND OR public.current_sacco_member_id() NOT IN (v_txn.source_member_id,v_txn.destination_member_id) THEN RAISE EXCEPTION 'Payment not found'; END IF;
  INSERT INTO public.sacco_member_payment_disputes(organization_id,payment_transaction_id,opened_by,reason) VALUES(v_txn.organization_id,v_txn.id,auth.uid(),trim(p_reason)) ON CONFLICT(payment_transaction_id,opened_by) DO UPDATE SET reason=excluded.reason,status='open',resolution_note=NULL,resolved_at=NULL,resolved_by=NULL RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sacco_reverse_member_payment(p_payment_transaction_id uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_actor public.staff%ROWTYPE; v_original public.sacco_member_payment_transactions%ROWTYPE; v_reversal uuid; v_ref text;
BEGIN
  SELECT * INTO v_actor FROM public.staff WHERE id=auth.uid();
  IF NOT FOUND OR lower(coalesce(v_actor.role,'')) NOT IN ('admin','super_admin','manager') THEN RAISE EXCEPTION 'Only an authorized SACCO manager can reverse a payment'; END IF;
  IF nullif(trim(coalesce(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'A reversal reason is required'; END IF;
  SELECT * INTO v_original FROM public.sacco_member_payment_transactions WHERE id=p_payment_transaction_id FOR UPDATE;
  IF NOT FOUND OR v_original.organization_id<>v_actor.organization_id THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF v_original.status='reversed' THEN RAISE EXCEPTION 'This payment has already been reversed'; END IF;
  v_ref:='SRV-'||to_char(current_timestamp,'YYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
  v_reversal:=public.sacco_post_member_payment(v_original.destination_account_id,v_original.source_account_id,v_original.amount,v_ref,'reversal:'||v_original.id::text,'reversal','Reversal: '||trim(p_reason),NULL);
  UPDATE public.sacco_member_payment_transactions SET status='reversed' WHERE id=v_original.id;
  UPDATE public.sacco_member_payment_transactions SET reversal_of=v_original.id WHERE id=v_reversal;
  INSERT INTO public.sacco_member_payment_notifications(organization_id,member_id,payment_transaction_id,notification_type,title,body) VALUES
    (v_original.organization_id,v_original.source_member_id,v_reversal,'payment_reversed','Payment reversed','Your payment '||v_original.reference||' was reversed: '||trim(p_reason)),
    (v_original.organization_id,v_original.destination_member_id,v_reversal,'payment_reversed','Payment reversed','A payment '||v_original.reference||' was reversed: '||trim(p_reason));
  RETURN jsonb_build_object('ok',true,'reversal_transaction_id',v_reversal,'reference',v_ref);
END;
$$;

CREATE OR REPLACE FUNCTION public.sacco_create_mini_app_payment_intent(p_mini_app_id uuid,p_amount numeric,p_service_reference text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_app public.sacco_mini_apps%ROWTYPE; v_account public.sacco_member_savings_accounts%ROWTYPE; v_qr public.sacco_member_payment_qr_intents%ROWTYPE; v_member uuid; v_intent uuid;
BEGIN
  v_member:=public.current_sacco_member_id();
  IF auth.uid() IS NULL OR v_member IS NULL THEN RAISE EXCEPTION 'Sign in as a SACCO member to use this service'; END IF;
  SELECT * INTO v_app FROM public.sacco_mini_apps WHERE id=p_mini_app_id AND organization_id=public.current_sacco_member_org_id() AND is_active=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'This service is not available'; END IF;
  IF p_amount IS NULL OR p_amount<v_app.minimum_amount OR (v_app.maximum_amount IS NOT NULL AND p_amount>v_app.maximum_amount) THEN RAISE EXCEPTION 'Service amount is outside the allowed range'; END IF;
  SELECT * INTO v_account FROM public.sacco_member_savings_accounts WHERE id=v_app.settlement_account_id AND organization_id=v_app.organization_id AND is_active=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'This service settlement account is unavailable'; END IF;
  INSERT INTO public.sacco_member_payment_qr_intents(organization_id,recipient_member_id,recipient_account_id,amount,note,expires_at,created_by)
    VALUES(v_app.organization_id,v_account.sacco_member_id,v_account.id,p_amount,coalesce(nullif(trim(coalesce(p_service_reference,'')),''),v_app.display_name),now()+interval '15 minutes',auth.uid()) RETURNING * INTO v_qr;
  INSERT INTO public.sacco_mini_app_payment_intents(organization_id,mini_app_id,payer_member_id,qr_intent_id,amount,service_reference)
    VALUES(v_app.organization_id,v_app.id,v_member,v_qr.id,p_amount,nullif(trim(coalesce(p_service_reference,'')),'')) RETURNING id INTO v_intent;
  RETURN jsonb_build_object('intent_id',v_intent,'payment_token',v_qr.token,'app_name',v_app.display_name,'amount',p_amount,'expires_at',v_qr.expires_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.sacco_mini_app_touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_sacco_mini_apps_touch ON public.sacco_mini_apps;
CREATE TRIGGER trg_sacco_mini_apps_touch BEFORE UPDATE ON public.sacco_mini_apps FOR EACH ROW EXECUTE FUNCTION public.sacco_mini_app_touch();

CREATE OR REPLACE FUNCTION public.sacco_pay_qr_intent(p_token uuid, p_source_account_id uuid, p_amount numeric DEFAULT NULL, p_idempotency_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_intent public.sacco_member_payment_qr_intents%ROWTYPE; v_source public.sacco_member_savings_accounts%ROWTYPE; v_txn uuid; v_amount numeric; v_ref text; v_mini_intent uuid;
BEGIN
  IF auth.uid() IS NULL OR public.current_sacco_member_id() IS NULL THEN RAISE EXCEPTION 'Sign in as a SACCO member to pay by QR'; END IF;
  SELECT * INTO v_intent FROM public.sacco_member_payment_qr_intents WHERE token=p_token FOR UPDATE;
  IF FOUND AND v_intent.status='paid' AND v_intent.payment_transaction_id IS NOT NULL THEN
    SELECT id INTO v_txn FROM public.sacco_member_payment_transactions WHERE id=v_intent.payment_transaction_id AND initiated_by=auth.uid();
    IF v_txn IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'transaction_id',v_txn,'already_paid',true); END IF;
  END IF;
  IF NOT FOUND OR v_intent.status<>'active' OR v_intent.expires_at<=now() THEN RAISE EXCEPTION 'QR payment request is expired or unavailable'; END IF;
  SELECT * INTO v_source FROM public.sacco_member_savings_accounts WHERE id=p_source_account_id AND sacco_member_id=public.current_sacco_member_id() AND organization_id=v_intent.organization_id AND is_active=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Select one of your active savings accounts'; END IF;
  IF v_source.id=v_intent.recipient_account_id THEN RAISE EXCEPTION 'Cannot pay your own QR request'; END IF;
  v_amount:=coalesce(v_intent.amount,p_amount);
  IF v_amount IS NULL OR v_amount<=0 OR (v_intent.amount IS NOT NULL AND p_amount IS NOT NULL AND p_amount<>v_intent.amount) THEN RAISE EXCEPTION 'QR payment amount is invalid'; END IF;
  SELECT id INTO v_mini_intent FROM public.sacco_mini_app_payment_intents WHERE qr_intent_id=v_intent.id AND status='pending' FOR UPDATE;
  v_ref:='SQR-'||to_char(current_timestamp,'YYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
  v_txn:=public.sacco_post_member_payment(v_source.id,v_intent.recipient_account_id,v_amount,v_ref,p_idempotency_key,CASE WHEN v_mini_intent IS NULL THEN 'qr_payment' ELSE 'mini_app_payment' END,v_intent.note,v_intent.id);
  UPDATE public.sacco_member_payment_qr_intents SET status='paid',paid_at=now(),payment_transaction_id=v_txn WHERE id=v_intent.id;
  IF v_mini_intent IS NOT NULL THEN UPDATE public.sacco_mini_app_payment_intents SET status='paid',paid_at=now() WHERE id=v_mini_intent; END IF;
  RETURN jsonb_build_object('ok',true,'transaction_id',v_txn,'reference',v_ref,'amount',v_amount,'mini_app_payment',v_mini_intent IS NOT NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.sacco_get_payment_qr_intent(p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_intent public.sacco_member_payment_qr_intents%ROWTYPE; v_member public.sacco_members%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.current_sacco_member_id() IS NULL THEN RAISE EXCEPTION 'Sign in as a SACCO member to use a QR payment request'; END IF;
  SELECT * INTO v_intent FROM public.sacco_member_payment_qr_intents WHERE token=p_token FOR UPDATE;
  IF NOT FOUND OR v_intent.status<>'active' OR v_intent.expires_at<=now() THEN
    IF FOUND AND v_intent.status='active' THEN UPDATE public.sacco_member_payment_qr_intents SET status='expired' WHERE id=v_intent.id; END IF;
    RAISE EXCEPTION 'QR payment request is expired or unavailable';
  END IF;
  SELECT * INTO v_member FROM public.sacco_members WHERE id=v_intent.recipient_member_id;
  RETURN jsonb_build_object('token',v_intent.token,'recipient_name',v_member.full_name,'recipient_account_id',v_intent.recipient_account_id,'amount',v_intent.amount,'note',v_intent.note,'expires_at',v_intent.expires_at);
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_open_member_payment_dispute(uuid,text), public.sacco_create_mini_app_payment_intent(uuid,numeric,text), public.sacco_reverse_member_payment(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sacco_open_member_payment_dispute(uuid,text), public.sacco_create_mini_app_payment_intent(uuid,numeric,text), public.sacco_reverse_member_payment(uuid,text) TO authenticated;
