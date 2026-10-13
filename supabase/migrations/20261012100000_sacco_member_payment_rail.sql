-- Member payment rail: staff-controlled queued transfers, instant member transfers,
-- and short-lived QR payment intents.  The ledger remains inside one SACCO.

CREATE TABLE IF NOT EXISTS public.sacco_member_payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_account_id uuid NOT NULL REFERENCES public.sacco_member_savings_accounts(id) ON DELETE RESTRICT,
  destination_account_id uuid NOT NULL REFERENCES public.sacco_member_savings_accounts(id) ON DELETE RESTRICT,
  source_member_id uuid NOT NULL REFERENCES public.sacco_members(id) ON DELETE RESTRICT,
  destination_member_id uuid NOT NULL REFERENCES public.sacco_members(id) ON DELETE RESTRICT,
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  reference text NOT NULL UNIQUE,
  idempotency_key text NOT NULL,
  payment_kind text NOT NULL CHECK (payment_kind IN ('member_transfer', 'qr_payment')),
  qr_intent_id uuid,
  note text,
  initiated_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sacco_member_payment_idempotency UNIQUE (organization_id, initiated_by, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_sacco_member_payment_transactions_source ON public.sacco_member_payment_transactions(source_member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sacco_member_payment_transactions_destination ON public.sacco_member_payment_transactions(destination_member_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.sacco_member_payment_qr_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  recipient_member_id uuid NOT NULL REFERENCES public.sacco_members(id) ON DELETE RESTRICT,
  recipient_account_id uuid NOT NULL REFERENCES public.sacco_member_savings_accounts(id) ON DELETE RESTRICT,
  token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  amount numeric(15,2) CHECK (amount IS NULL OR amount > 0),
  note text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paid', 'cancelled', 'expired')),
  expires_at timestamptz NOT NULL,
  paid_at timestamptz,
  payment_transaction_id uuid REFERENCES public.sacco_member_payment_transactions(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sacco_member_payment_qr_recipient ON public.sacco_member_payment_qr_intents(recipient_member_id, status, expires_at DESC);

ALTER TABLE public.sacco_member_payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_member_payment_qr_intents ENABLE ROW LEVEL SECURITY;
CREATE POLICY sacco_member_payment_transactions_member_read ON public.sacco_member_payment_transactions FOR SELECT TO authenticated
  USING (source_member_id = public.current_sacco_member_id() OR destination_member_id = public.current_sacco_member_id());
CREATE POLICY sacco_member_payment_transactions_staff_read ON public.sacco_member_payment_transactions FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM public.staff WHERE id = auth.uid()));
CREATE POLICY sacco_member_payment_qr_intents_member_read ON public.sacco_member_payment_qr_intents FOR SELECT TO authenticated
  USING (recipient_member_id = public.current_sacco_member_id());
CREATE POLICY sacco_member_payment_qr_intents_staff_read ON public.sacco_member_payment_qr_intents FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM public.staff WHERE id = auth.uid()));
GRANT SELECT ON public.sacco_member_payment_transactions, public.sacco_member_payment_qr_intents TO authenticated;

-- Queue processing is not a member capability.  Preserve the existing staff workflow,
-- but derive the audit actor from auth.uid() instead of accepting caller supplied identity.
ALTER FUNCTION public.process_sacco_member_transfer_request(uuid, uuid)
  RENAME TO process_sacco_member_transfer_request_guarded;
REVOKE ALL ON FUNCTION public.process_sacco_member_transfer_request_guarded(uuid, uuid) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION public.process_sacco_member_transfer_request(p_request_id uuid, p_processed_by uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor public.staff%ROWTYPE; v_request_org uuid;
BEGIN
  SELECT * INTO v_actor FROM public.staff WHERE id = auth.uid();
  IF NOT FOUND OR lower(coalesce(v_actor.role, '')) NOT IN ('admin', 'super_admin', 'manager', 'teller') THEN
    RAISE EXCEPTION 'Only authorized SACCO staff can process transfer requests';
  END IF;
  SELECT organization_id INTO v_request_org FROM public.sacco_member_requests WHERE id = p_request_id;
  IF v_request_org IS NULL OR v_request_org <> v_actor.organization_id THEN
    RAISE EXCEPTION 'Transfer request not found';
  END IF;
  -- The former implementation is intentionally replaced below by a guarded worker call.
  RETURN public.process_sacco_member_transfer_request_guarded(p_request_id, v_actor.id);
END;
$$;
REVOKE ALL ON FUNCTION public.process_sacco_member_transfer_request(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_sacco_member_transfer_request(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.sacco_post_member_payment(
  p_source_account_id uuid, p_destination_account_id uuid, p_amount numeric,
  p_reference text, p_idempotency_key text, p_kind text, p_note text DEFAULT NULL,
  p_qr_intent_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_source public.sacco_member_savings_accounts%ROWTYPE;
  v_destination public.sacco_member_savings_accounts%ROWTYPE;
  v_source_member public.sacco_members%ROWTYPE;
  v_destination_member public.sacco_members%ROWTYPE;
  v_txn_id uuid;
  v_from_prev numeric := 0;
  v_to_prev numeric := 0;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 100000000 THEN RAISE EXCEPTION 'Enter a valid transfer amount'; END IF;
  IF nullif(trim(coalesce(p_idempotency_key, '')), '') IS NULL THEN RAISE EXCEPTION 'A payment idempotency key is required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(least(p_source_account_id::text, p_destination_account_id::text)));
  PERFORM pg_advisory_xact_lock(hashtext(greatest(p_source_account_id::text, p_destination_account_id::text)));
  SELECT * INTO v_source FROM public.sacco_member_savings_accounts WHERE id = p_source_account_id AND is_active = true FOR UPDATE;
  SELECT * INTO v_destination FROM public.sacco_member_savings_accounts WHERE id = p_destination_account_id AND is_active = true FOR UPDATE;
  IF NOT FOUND OR v_source.id IS NULL OR v_destination.id IS NULL OR v_source.organization_id <> v_destination.organization_id THEN RAISE EXCEPTION 'Savings account not found'; END IF;
  IF v_source.id = v_destination.id THEN RAISE EXCEPTION 'Cannot transfer to the same savings account'; END IF;
  SELECT * INTO v_source_member FROM public.sacco_members WHERE id = v_source.sacco_member_id AND is_active = true;
  SELECT * INTO v_destination_member FROM public.sacco_members WHERE id = v_destination.sacco_member_id AND is_active = true;
  IF v_source_member.id IS NULL OR v_destination_member.id IS NULL THEN RAISE EXCEPTION 'Both members must be active'; END IF;
  SELECT id INTO v_txn_id FROM public.sacco_member_payment_transactions
   WHERE organization_id = v_source.organization_id AND initiated_by = auth.uid() AND idempotency_key = p_idempotency_key;
  IF v_txn_id IS NOT NULL THEN RETURN v_txn_id; END IF;
  IF v_source.balance < p_amount THEN RAISE EXCEPTION 'Insufficient available savings balance'; END IF;
  UPDATE public.sacco_member_savings_accounts SET balance = balance - p_amount WHERE id = v_source.id;
  UPDATE public.sacco_member_savings_accounts SET balance = balance + p_amount WHERE id = v_destination.id;
  INSERT INTO public.sacco_member_payment_transactions(organization_id,source_account_id,destination_account_id,source_member_id,destination_member_id,amount,reference,idempotency_key,payment_kind,qr_intent_id,note,initiated_by)
  VALUES(v_source.organization_id,v_source.id,v_destination.id,v_source_member.id,v_destination_member.id,p_amount,p_reference,p_idempotency_key,p_kind,p_qr_intent_id,nullif(trim(coalesce(p_note,'')),''),auth.uid()) RETURNING id INTO v_txn_id;
  SELECT coalesce(balance,0) INTO v_from_prev FROM public.sacco_cashbook_entries WHERE organization_id=v_source.organization_id AND sacco_member_id=v_source_member.id ORDER BY created_at DESC LIMIT 1;
  SELECT coalesce(balance,0) INTO v_to_prev FROM public.sacco_cashbook_entries WHERE organization_id=v_source.organization_id AND sacco_member_id=v_destination_member.id ORDER BY created_at DESC LIMIT 1;
  INSERT INTO public.sacco_cashbook_entries(organization_id,entry_date,description,reference,category,sacco_member_id,member_name,debit,credit,balance) VALUES
    (v_source.organization_id,current_date,'Member payment to '||v_destination_member.member_number,p_reference,'Member payment',v_source_member.id,v_source_member.full_name,0,p_amount,v_from_prev-p_amount),
    (v_source.organization_id,current_date,'Member payment from '||v_source_member.member_number,p_reference,'Member payment',v_destination_member.id,v_destination_member.full_name,p_amount,0,v_to_prev+p_amount);
  RETURN v_txn_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sacco_member_instant_transfer(p_source_account_id uuid, p_destination text, p_amount numeric, p_note text DEFAULT NULL, p_idempotency_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_source public.sacco_member_savings_accounts%ROWTYPE; v_destination public.sacco_member_savings_accounts%ROWTYPE; v_txn uuid; v_ref text;
BEGIN
  IF auth.uid() IS NULL OR public.current_sacco_member_id() IS NULL THEN RAISE EXCEPTION 'Sign in as a SACCO member to transfer funds'; END IF;
  SELECT * INTO v_source FROM public.sacco_member_savings_accounts WHERE id=p_source_account_id AND sacco_member_id=public.current_sacco_member_id() AND organization_id=public.current_sacco_member_org_id() AND is_active=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Select one of your active savings accounts'; END IF;
  SELECT a.* INTO v_destination FROM public.sacco_member_savings_accounts a JOIN public.sacco_members m ON m.id=a.sacco_member_id
   WHERE a.organization_id=v_source.organization_id AND a.is_active=true AND (lower(a.account_number)=lower(trim(coalesce(p_destination,''))) OR lower(m.member_number)=lower(trim(coalesce(p_destination,'')))) ORDER BY a.created_at LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recipient savings account not found'; END IF;
  v_ref := 'SMT-'||to_char(current_timestamp,'YYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
  v_txn := public.sacco_post_member_payment(v_source.id,v_destination.id,p_amount,v_ref,p_idempotency_key,'member_transfer',p_note,NULL);
  RETURN jsonb_build_object('ok',true,'transaction_id',v_txn,'reference',v_ref,'recipient_account',v_destination.account_number);
END;
$$;

CREATE OR REPLACE FUNCTION public.sacco_create_payment_qr_intent(p_recipient_account_id uuid, p_amount numeric DEFAULT NULL, p_note text DEFAULT NULL, p_expires_minutes integer DEFAULT 15)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_account public.sacco_member_savings_accounts%ROWTYPE; v_intent public.sacco_member_payment_qr_intents%ROWTYPE; v_minutes integer;
BEGIN
  IF auth.uid() IS NULL OR public.current_sacco_member_id() IS NULL THEN RAISE EXCEPTION 'Sign in as a SACCO member to create a QR payment request'; END IF;
  SELECT * INTO v_account FROM public.sacco_member_savings_accounts WHERE id=p_recipient_account_id AND sacco_member_id=public.current_sacco_member_id() AND organization_id=public.current_sacco_member_org_id() AND is_active=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Select one of your active savings accounts'; END IF;
  IF p_amount IS NOT NULL AND p_amount <= 0 THEN RAISE EXCEPTION 'QR amount must be positive'; END IF;
  v_minutes := greatest(1,least(coalesce(p_expires_minutes,15),60));
  INSERT INTO public.sacco_member_payment_qr_intents(organization_id,recipient_member_id,recipient_account_id,amount,note,expires_at,created_by)
  VALUES(v_account.organization_id,v_account.sacco_member_id,v_account.id,p_amount,nullif(trim(coalesce(p_note,'')),''),now()+make_interval(mins=>v_minutes),auth.uid()) RETURNING * INTO v_intent;
  RETURN jsonb_build_object('token',v_intent.token,'amount',v_intent.amount,'note',v_intent.note,'expires_at',v_intent.expires_at,'recipient_account',v_account.account_number);
END;
$$;

CREATE OR REPLACE FUNCTION public.sacco_get_payment_qr_intent(p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_intent public.sacco_member_payment_qr_intents%ROWTYPE; v_member public.sacco_members%ROWTYPE;
BEGIN
  SELECT * INTO v_intent FROM public.sacco_member_payment_qr_intents WHERE token=p_token FOR UPDATE;
  IF NOT FOUND OR v_intent.status <> 'active' OR v_intent.expires_at <= now() THEN
    IF FOUND AND v_intent.status='active' THEN UPDATE public.sacco_member_payment_qr_intents SET status='expired' WHERE id=v_intent.id; END IF;
    RAISE EXCEPTION 'QR payment request is expired or unavailable';
  END IF;
  SELECT * INTO v_member FROM public.sacco_members WHERE id=v_intent.recipient_member_id;
  RETURN jsonb_build_object('token',v_intent.token,'recipient_name',v_member.full_name,'recipient_account_id',v_intent.recipient_account_id,'amount',v_intent.amount,'note',v_intent.note,'expires_at',v_intent.expires_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.sacco_pay_qr_intent(p_token uuid, p_source_account_id uuid, p_amount numeric DEFAULT NULL, p_idempotency_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_intent public.sacco_member_payment_qr_intents%ROWTYPE; v_source public.sacco_member_savings_accounts%ROWTYPE; v_txn uuid; v_amount numeric; v_ref text;
BEGIN
  IF auth.uid() IS NULL OR public.current_sacco_member_id() IS NULL THEN RAISE EXCEPTION 'Sign in as a SACCO member to pay by QR'; END IF;
  SELECT * INTO v_intent FROM public.sacco_member_payment_qr_intents WHERE token=p_token FOR UPDATE;
  IF FOUND AND v_intent.status='paid' AND v_intent.payment_transaction_id IS NOT NULL THEN
    SELECT id INTO v_txn FROM public.sacco_member_payment_transactions WHERE id=v_intent.payment_transaction_id AND initiated_by=auth.uid();
    IF v_txn IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'transaction_id',v_txn,'already_paid',true); END IF;
  END IF;
  IF NOT FOUND OR v_intent.status <> 'active' OR v_intent.expires_at <= now() THEN RAISE EXCEPTION 'QR payment request is expired or unavailable'; END IF;
  SELECT * INTO v_source FROM public.sacco_member_savings_accounts WHERE id=p_source_account_id AND sacco_member_id=public.current_sacco_member_id() AND organization_id=v_intent.organization_id AND is_active=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Select one of your active savings accounts'; END IF;
  IF v_source.id=v_intent.recipient_account_id THEN RAISE EXCEPTION 'Cannot pay your own QR request'; END IF;
  v_amount := coalesce(v_intent.amount,p_amount);
  IF v_amount IS NULL OR v_amount <= 0 OR (v_intent.amount IS NOT NULL AND p_amount IS NOT NULL AND p_amount<>v_intent.amount) THEN RAISE EXCEPTION 'QR payment amount is invalid'; END IF;
  v_ref := 'SQR-'||to_char(current_timestamp,'YYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
  v_txn := public.sacco_post_member_payment(v_source.id,v_intent.recipient_account_id,v_amount,v_ref,p_idempotency_key,'qr_payment',v_intent.note,v_intent.id);
  UPDATE public.sacco_member_payment_qr_intents SET status='paid',paid_at=now(),payment_transaction_id=v_txn WHERE id=v_intent.id;
  RETURN jsonb_build_object('ok',true,'transaction_id',v_txn,'reference',v_ref,'amount',v_amount);
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_post_member_payment(uuid,uuid,numeric,text,text,text,text,uuid) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.sacco_member_instant_transfer(uuid,text,numeric,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sacco_create_payment_qr_intent(uuid,numeric,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sacco_get_payment_qr_intent(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sacco_pay_qr_intent(uuid,uuid,numeric,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sacco_member_instant_transfer(uuid,text,numeric,text,text), public.sacco_create_payment_qr_intent(uuid,numeric,text,integer), public.sacco_get_payment_qr_intent(uuid), public.sacco_pay_qr_intent(uuid,uuid,numeric,text) TO authenticated;
