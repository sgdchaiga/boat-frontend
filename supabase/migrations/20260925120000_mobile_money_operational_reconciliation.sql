-- Make POS mobile-money collections safe to operate asynchronously.
-- A sale is posted with a pending tender first; this migration binds its unique
-- provider reference and settles it idempotently when the gateway updates the
-- attempt status.

CREATE OR REPLACE FUNCTION public.bind_mobile_money_attempt(
  p_sale_id uuid,
  p_payment_method text,
  p_amount numeric,
  p_tx_ref text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_sale_org uuid;
  v_retail_payment_id uuid;
  v_payment_id uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.staff WHERE id = auth.uid();
  SELECT organization_id INTO v_sale_org FROM public.retail_sales WHERE id = p_sale_id;
  IF v_org IS NULL OR v_sale_org IS NULL OR v_org <> v_sale_org THEN
    RAISE EXCEPTION 'Retail sale is not available to the current organization';
  END IF;
  IF p_payment_method NOT IN ('mtn_mobile_money', 'airtel_money') OR p_amount IS NULL OR p_amount <= 0 OR nullif(trim(p_tx_ref), '') IS NULL THEN
    RAISE EXCEPTION 'A valid mobile money method, amount, and transaction reference are required';
  END IF;

  SELECT id INTO v_retail_payment_id
  FROM public.retail_sale_payments
  WHERE sale_id = p_sale_id
    AND payment_method = p_payment_method
    AND round(amount::numeric, 2) = round(p_amount, 2)
    AND payment_status = 'pending'
    AND reference IS NULL
  ORDER BY id
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  IF v_retail_payment_id IS NULL THEN
    RAISE EXCEPTION 'No unbound pending retail tender was found';
  END IF;
  UPDATE public.retail_sale_payments SET reference = p_tx_ref WHERE id = v_retail_payment_id;

  SELECT id INTO v_payment_id
  FROM public.payments
  WHERE organization_id = v_org
    AND transaction_id = p_sale_id::text
    AND payment_method = p_payment_method
    AND round(amount::numeric, 2) = round(p_amount, 2)
    AND payment_status = 'pending'
    AND COALESCE(source_documents->>'mobile_money_tx_ref', '') = ''
  ORDER BY created_at, id
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  IF v_payment_id IS NULL THEN
    RAISE EXCEPTION 'No unbound pending payment was found';
  END IF;
  UPDATE public.payments
     SET source_documents = COALESCE(source_documents, '{}'::jsonb) || jsonb_build_object('mobile_money_tx_ref', p_tx_ref)
   WHERE id = v_payment_id;

  RETURN jsonb_build_object('ok', true, 'retail_sale_payment_id', v_retail_payment_id, 'payment_id', v_payment_id);
END;
$$;

REVOKE ALL ON FUNCTION public.bind_mobile_money_attempt(uuid, text, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bind_mobile_money_attempt(uuid, text, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reconcile_mobile_money_attempt(p_tx_ref text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt public.mobile_money_attempts%ROWTYPE;
  v_new_status text;
  v_completed_paid numeric(15,2) := 0;
  v_sale_total numeric(15,2) := 0;
  v_sale_status text := 'pending';
  v_retail_updated integer := 0;
  v_payment_updated integer := 0;
  v_receipt_gl uuid;
  v_receivable_gl uuid;
  v_journal_id uuid;
BEGIN
  SELECT * INTO v_attempt FROM public.mobile_money_attempts WHERE tx_ref = p_tx_ref;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'attempt_not_found'); END IF;
  IF v_attempt.sale_id IS NULL THEN RETURN jsonb_build_object('ok', true, 'reason', 'no_sale_id'); END IF;

  v_new_status := CASE
    WHEN v_attempt.status = 'successful' THEN 'completed'
    WHEN v_attempt.status IN ('failed', 'cancelled', 'timeout') THEN 'failed'
    ELSE 'pending'
  END;

  -- tx_ref, not amount/method, is the reconciliation key. It is safe for split
  -- tenders and duplicate-value payment lines in the same sale.
  UPDATE public.retail_sale_payments
     SET payment_status = v_new_status,
         paid_at = CASE WHEN v_new_status = 'completed' THEN COALESCE(v_attempt.paid_at, now()) ELSE paid_at END
   WHERE sale_id = v_attempt.sale_id
     AND reference = v_attempt.tx_ref
     AND payment_status IN ('pending', 'failed');
  GET DIAGNOSTICS v_retail_updated = ROW_COUNT;

  UPDATE public.payments
     SET payment_status = v_new_status,
         paid_at = CASE WHEN v_new_status = 'completed' THEN COALESCE(v_attempt.paid_at, now()) ELSE paid_at END,
         source_documents = COALESCE(source_documents, '{}'::jsonb) || jsonb_build_object(
           'mobile_money_tx_ref', v_attempt.tx_ref,
           'mobile_money_gateway', v_attempt.gateway_provider,
           'gateway_transaction_id', v_attempt.flutterwave_tx_id,
           'gateway_transaction_token', v_attempt.dpo_transaction_token,
           'gateway_transaction_ref', v_attempt.gateway_transaction_ref,
           'mobile_money_attempt_status', v_attempt.status
         )
   WHERE organization_id = v_attempt.organization_id
     AND transaction_id = v_attempt.sale_id::text
     AND source_documents->>'mobile_money_tx_ref' = v_attempt.tx_ref
     AND payment_status IN ('pending', 'failed');
  GET DIAGNOSTICS v_payment_updated = ROW_COUNT;

  SELECT COALESCE(total_amount, 0) INTO v_sale_total FROM public.retail_sales WHERE id = v_attempt.sale_id;
  SELECT COALESCE(SUM(amount), 0) INTO v_completed_paid FROM public.retail_sale_payments
   WHERE sale_id = v_attempt.sale_id AND payment_status = 'completed';
  v_sale_status := CASE WHEN v_completed_paid <= 0 THEN 'pending' WHEN v_completed_paid < v_sale_total THEN 'partial' WHEN v_completed_paid > v_sale_total THEN 'overpaid' ELSE 'completed' END;
  UPDATE public.retail_sales SET amount_paid = v_completed_paid, amount_due = GREATEST(v_sale_total - v_completed_paid, 0), payment_status = v_sale_status WHERE id = v_attempt.sale_id;

  -- Pending POS sales debit receivables at sale time. On confirmation, move the
  -- exact tender from receivables into the network's mobile-money asset account.
  IF v_attempt.status = 'successful' AND v_retail_updated > 0 THEN
    SELECT CASE WHEN v_attempt.payment_method = 'airtel_money'
                  THEN COALESCE(pos_airtel_money_gl_account_id, cash_gl_account_id)
                ELSE COALESCE(pos_mtn_mobile_money_gl_account_id, cash_gl_account_id) END,
           receivable_gl_account_id
      INTO v_receipt_gl, v_receivable_gl
      FROM public.journal_gl_settings
     WHERE organization_id = v_attempt.organization_id;
    IF v_receipt_gl IS NOT NULL AND v_receivable_gl IS NOT NULL THEN
      v_journal_id := public.create_journal_entry_atomic(
        COALESCE(v_attempt.paid_at, now())::date,
        'Mobile money receipt ' || v_attempt.tx_ref,
        'mobile_money_attempt', v_attempt.id, NULL,
        jsonb_build_array(
          jsonb_build_object('gl_account_id', v_receipt_gl, 'debit', v_attempt.amount, 'credit', 0, 'line_description', 'Mobile money received'),
          jsonb_build_object('gl_account_id', v_receivable_gl, 'debit', 0, 'credit', v_attempt.amount, 'line_description', 'Retail receivable settled')
        ),
        v_attempt.organization_id
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', v_attempt.status, 'sale_id', v_attempt.sale_id, 'retail_sale_payments_updated', v_retail_updated, 'payments_updated', v_payment_updated, 'sale_payment_status', v_sale_status, 'journal_id', v_journal_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_mobile_money_attempt_on_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.reconcile_mobile_money_attempt(NEW.tx_ref);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reconcile_mobile_money_attempt ON public.mobile_money_attempts;
CREATE TRIGGER trg_reconcile_mobile_money_attempt
AFTER INSERT OR UPDATE OF status ON public.mobile_money_attempts
FOR EACH ROW EXECUTE FUNCTION public.reconcile_mobile_money_attempt_on_change();

REVOKE ALL ON FUNCTION public.reconcile_mobile_money_attempt(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_mobile_money_attempt(text) TO service_role;

NOTIFY pgrst, 'reload schema';
