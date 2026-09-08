-- Customer wallet/mobile-money self-service:
-- - track mobile-money attempts that target wallet top-ups or invoice payments
-- - provide RPCs for wallet bill payments and mobile-money reconciliation

ALTER TABLE public.mobile_money_attempts
  ADD COLUMN IF NOT EXISTS wallet_id uuid REFERENCES public.wallets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS retail_invoice_id uuid REFERENCES public.retail_invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_kind text CHECK (customer_kind IN ('hotel', 'retail', 'student')),
  ADD COLUMN IF NOT EXISTS hotel_customer_id uuid REFERENCES public.hotel_customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS retail_customer_id uuid REFERENCES public.retail_customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'pos_sale'
    CHECK (purpose IN ('pos_sale', 'wallet_topup', 'wallet_bill_payment'));

CREATE INDEX IF NOT EXISTS idx_mobile_money_attempts_wallet
  ON public.mobile_money_attempts (wallet_id, created_at DESC)
  WHERE wallet_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mobile_money_attempts_invoice
  ON public.mobile_money_attempts (retail_invoice_id, created_at DESC)
  WHERE retail_invoice_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.customer_wallet_mobile_money_finalize(p_tx_ref text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt public.mobile_money_attempts%ROWTYPE;
  v_wallet public.wallets%ROWTYPE;
  v_txn_id uuid;
  v_pay_id uuid;
  v_paid_total numeric(15,2);
  v_invoice_total numeric(15,2);
  v_method text;
BEGIN
  SELECT *
    INTO v_attempt
    FROM public.mobile_money_attempts
   WHERE tx_ref = p_tx_ref
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'attempt_not_found');
  END IF;

  IF v_attempt.status <> 'successful' THEN
    RETURN jsonb_build_object('ok', true, 'status', v_attempt.status, 'reason', 'not_successful');
  END IF;

  IF v_attempt.purpose NOT IN ('wallet_topup', 'wallet_bill_payment') THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'not_customer_wallet_attempt');
  END IF;

  IF v_attempt.wallet_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'wallet_id_missing');
  END IF;

  SELECT * INTO v_wallet
    FROM public.wallets
   WHERE id = v_attempt.wallet_id
     AND organization_id = v_attempt.organization_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'wallet_not_found');
  END IF;

  v_method := CASE
    WHEN v_attempt.network = 'airtel' THEN 'airtel_money'
    ELSE 'mtn_mobile_money'
  END;

  IF v_attempt.purpose = 'wallet_topup' THEN
    SELECT id INTO v_txn_id
      FROM public.wallet_transactions
     WHERE organization_id = v_attempt.organization_id
       AND wallet_id = v_attempt.wallet_id
       AND idempotency_key = 'mm:' || v_attempt.tx_ref
     LIMIT 1;

    IF v_txn_id IS NULL THEN
      v_txn_id := public.wallet_post_transaction(
        v_attempt.wallet_id,
        'deposit',
        v_attempt.amount,
        NULL,
        v_attempt.tx_ref,
        'Mobile money wallet top-up',
        NULL,
        'mm:' || v_attempt.tx_ref,
        jsonb_build_object(
          'mobile_money_tx_ref', v_attempt.tx_ref,
          'gateway_provider', v_attempt.gateway_provider,
          'network', v_attempt.network,
          'phone_number', v_attempt.phone_number
        )
      );
    END IF;

    RETURN jsonb_build_object('ok', true, 'purpose', v_attempt.purpose, 'wallet_transaction_id', v_txn_id);
  END IF;

  IF v_attempt.retail_invoice_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'retail_invoice_id_missing');
  END IF;

  SELECT id INTO v_pay_id
    FROM public.payments
   WHERE organization_id = v_attempt.organization_id
     AND transaction_id = v_attempt.tx_ref
   LIMIT 1;

  IF v_pay_id IS NULL THEN
    INSERT INTO public.payments (
      organization_id,
      amount,
      payment_method,
      payment_status,
      transaction_id,
      paid_at,
      retail_customer_id,
      property_customer_id,
      invoice_allocations,
      payment_source,
      source_documents
    )
    VALUES (
      v_attempt.organization_id,
      v_attempt.amount,
      v_method,
      'completed',
      v_attempt.tx_ref,
      COALESCE(v_attempt.paid_at, now()),
      v_wallet.retail_customer_id,
      v_wallet.hotel_customer_id,
      jsonb_build_array(jsonb_build_object('invoice_id', v_attempt.retail_invoice_id, 'amount', v_attempt.amount)),
      'debtor',
      jsonb_build_object(
        'mobile_money_tx_ref', v_attempt.tx_ref,
        'mobile_money_gateway', v_attempt.gateway_provider,
        'wallet_id', v_attempt.wallet_id,
        'purpose', v_attempt.purpose
      )
    )
    RETURNING id INTO v_pay_id;
  END IF;

  SELECT total INTO v_invoice_total
    FROM public.retail_invoices
   WHERE id = v_attempt.retail_invoice_id
     AND organization_id = v_attempt.organization_id;

  SELECT COALESCE(SUM((alloc->>'amount')::numeric), 0)
    INTO v_paid_total
    FROM public.payments p
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.invoice_allocations, '[]'::jsonb)) alloc
   WHERE p.organization_id = v_attempt.organization_id
     AND p.payment_status = 'completed'
     AND alloc->>'invoice_id' = v_attempt.retail_invoice_id::text;

  IF v_invoice_total IS NOT NULL AND v_paid_total + 0.001 >= v_invoice_total THEN
    UPDATE public.retail_invoices
       SET status = 'paid'
     WHERE id = v_attempt.retail_invoice_id
       AND status <> 'void';
  END IF;

  RETURN jsonb_build_object('ok', true, 'purpose', v_attempt.purpose, 'payment_id', v_pay_id);
END;
$$;

REVOKE ALL ON FUNCTION public.customer_wallet_mobile_money_finalize(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_wallet_mobile_money_finalize(text) TO service_role;

CREATE OR REPLACE FUNCTION public.wallet_pay_retail_invoice(
  p_wallet_id uuid,
  p_invoice_id uuid,
  p_amount numeric,
  p_reference text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet public.wallets%ROWTYPE;
  v_invoice public.retail_invoices%ROWTYPE;
  v_txn_id uuid;
  v_pay_id uuid;
  v_ref text;
  v_paid_total numeric(15,2);
BEGIN
  SELECT * INTO v_wallet FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet not found'; END IF;

  SELECT * INTO v_invoice
    FROM public.retail_invoices
   WHERE id = p_invoice_id
     AND organization_id = v_wallet.organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF v_invoice.status = 'void' THEN RAISE EXCEPTION 'Cannot pay a void invoice'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;

  IF v_wallet.customer_kind = 'retail' AND v_invoice.customer_id IS NOT NULL AND v_invoice.customer_id <> v_wallet.retail_customer_id THEN
    RAISE EXCEPTION 'Invoice does not belong to this retail wallet';
  END IF;
  IF v_wallet.customer_kind = 'hotel' AND v_invoice.property_customer_id IS NOT NULL AND v_invoice.property_customer_id <> v_wallet.hotel_customer_id THEN
    RAISE EXCEPTION 'Invoice does not belong to this hotel wallet';
  END IF;

  v_ref := COALESCE(NULLIF(trim(p_reference), ''), 'wallet-invoice:' || p_invoice_id::text || ':' || gen_random_uuid()::text);

  v_txn_id := public.wallet_post_transaction(
    p_wallet_id,
    'payment',
    p_amount,
    NULL,
    v_ref,
    'Wallet bill payment ' || v_invoice.invoice_number,
    p_created_by,
    'invoice:' || p_invoice_id::text || ':' || v_ref,
    jsonb_build_object('invoice_id', p_invoice_id, 'invoice_number', v_invoice.invoice_number)
  );

  INSERT INTO public.payments (
    organization_id,
    amount,
    payment_method,
    payment_status,
    transaction_id,
    paid_at,
    processed_by,
    retail_customer_id,
    property_customer_id,
    invoice_allocations,
    payment_source,
    source_documents
  )
  VALUES (
    v_wallet.organization_id,
    p_amount,
    'wallet',
    'completed',
    v_ref,
    now(),
    p_created_by,
    v_wallet.retail_customer_id,
    v_wallet.hotel_customer_id,
    jsonb_build_array(jsonb_build_object('invoice_id', p_invoice_id, 'amount', p_amount)),
    'debtor',
    jsonb_build_object('wallet_transaction_id', v_txn_id, 'wallet_id', p_wallet_id)
  )
  RETURNING id INTO v_pay_id;

  SELECT COALESCE(SUM((alloc->>'amount')::numeric), 0)
    INTO v_paid_total
    FROM public.payments p
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.invoice_allocations, '[]'::jsonb)) alloc
   WHERE p.organization_id = v_wallet.organization_id
     AND p.payment_status = 'completed'
     AND alloc->>'invoice_id' = p_invoice_id::text;

  IF v_paid_total + 0.001 >= v_invoice.total THEN
    UPDATE public.retail_invoices SET status = 'paid' WHERE id = p_invoice_id AND status <> 'void';
  END IF;

  RETURN jsonb_build_object('ok', true, 'wallet_transaction_id', v_txn_id, 'payment_id', v_pay_id);
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_pay_retail_invoice(uuid, uuid, numeric, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_pay_retail_invoice(uuid, uuid, numeric, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.process_sacco_member_transfer_request(p_request_id uuid, p_processed_by uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.sacco_member_requests%ROWTYPE;
  v_from_account public.sacco_member_savings_accounts%ROWTYPE;
  v_to_account public.sacco_member_savings_accounts%ROWTYPE;
  v_from_member public.sacco_members%ROWTYPE;
  v_to_member public.sacco_members%ROWTYPE;
  v_from_prev numeric := 0;
  v_to_prev numeric := 0;
  v_ref text;
BEGIN
  SELECT * INTO v_req
    FROM public.sacco_member_requests
   WHERE id = p_request_id
   FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF v_req.request_type <> 'member_transfer' THEN RAISE EXCEPTION 'Only member_transfer requests are supported by this processor'; END IF;
  IF v_req.status NOT IN ('pending', 'processing') THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'status', v_req.status);
  END IF;

  UPDATE public.sacco_member_requests
     SET status = 'processing'
   WHERE id = p_request_id;

  SELECT * INTO v_from_member
    FROM public.sacco_members
   WHERE id = v_req.sacco_member_id
     AND organization_id = v_req.organization_id
     AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source member not found or inactive'; END IF;

  SELECT * INTO v_from_account
    FROM public.sacco_member_savings_accounts
   WHERE organization_id = v_req.organization_id
     AND sacco_member_id = v_req.sacco_member_id
     AND is_active = true
   ORDER BY created_at
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source savings account not found'; END IF;
  IF v_from_account.balance < v_req.amount THEN RAISE EXCEPTION 'Insufficient savings balance'; END IF;

  SELECT a.* INTO v_to_account
    FROM public.sacco_member_savings_accounts a
    JOIN public.sacco_members m ON m.id = a.sacco_member_id
   WHERE a.organization_id = v_req.organization_id
     AND a.is_active = true
     AND (
       lower(a.account_number) = lower(trim(COALESCE(v_req.destination, '')))
       OR lower(m.member_number) = lower(trim(COALESCE(v_req.destination, '')))
     )
   ORDER BY a.created_at
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recipient savings account not found'; END IF;
  IF v_to_account.id = v_from_account.id THEN RAISE EXCEPTION 'Cannot transfer to the same savings account'; END IF;

  SELECT * INTO v_to_member
    FROM public.sacco_members
   WHERE id = v_to_account.sacco_member_id
     AND organization_id = v_req.organization_id
     AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recipient member not found or inactive'; END IF;

  UPDATE public.sacco_member_savings_accounts
     SET balance = balance - v_req.amount
   WHERE id = v_from_account.id;

  UPDATE public.sacco_member_savings_accounts
     SET balance = balance + v_req.amount
   WHERE id = v_to_account.id;

  v_ref := 'member-request:' || p_request_id::text;

  SELECT COALESCE(balance, 0) INTO v_from_prev
    FROM public.sacco_cashbook_entries
   WHERE organization_id = v_req.organization_id
     AND sacco_member_id = v_from_member.id
   ORDER BY created_at DESC
   LIMIT 1;

  INSERT INTO public.sacco_cashbook_entries (
    organization_id, entry_date, description, reference, category, sacco_member_id, member_name, debit, credit, balance
  )
  VALUES (
    v_req.organization_id,
    CURRENT_DATE,
    'Member transfer to ' || v_to_member.member_number,
    v_ref,
    'Member app transfer',
    v_from_member.id,
    v_from_member.full_name,
    0,
    v_req.amount,
    COALESCE(v_from_prev, 0) - v_req.amount
  );

  SELECT COALESCE(balance, 0) INTO v_to_prev
    FROM public.sacco_cashbook_entries
   WHERE organization_id = v_req.organization_id
     AND sacco_member_id = v_to_member.id
   ORDER BY created_at DESC
   LIMIT 1;

  INSERT INTO public.sacco_cashbook_entries (
    organization_id, entry_date, description, reference, category, sacco_member_id, member_name, debit, credit, balance
  )
  VALUES (
    v_req.organization_id,
    CURRENT_DATE,
    'Member transfer from ' || v_from_member.member_number,
    v_ref,
    'Member app transfer',
    v_to_member.id,
    v_to_member.full_name,
    v_req.amount,
    0,
    COALESCE(v_to_prev, 0) + v_req.amount
  );

  UPDATE public.sacco_member_requests
     SET status = 'completed',
         processed_at = now(),
         processed_by = p_processed_by
   WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'ok', true,
    'request_id', p_request_id,
    'from_account_id', v_from_account.id,
    'to_account_id', v_to_account.id,
    'amount', v_req.amount
  );
EXCEPTION WHEN OTHERS THEN
  UPDATE public.sacco_member_requests
     SET status = 'rejected',
         processed_at = now(),
         processed_by = p_processed_by,
         note = COALESCE(note, '') || CASE WHEN COALESCE(note, '') = '' THEN '' ELSE E'\n' END || 'Processing failed: ' || SQLERRM
   WHERE id = p_request_id;
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.process_sacco_member_transfer_request(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_sacco_member_transfer_request(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
