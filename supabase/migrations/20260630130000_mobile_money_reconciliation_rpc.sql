-- Reconcile Flutterwave MTN/Airtel attempts back into posted POS payment rows.
-- Conservative by design: callbacks may update existing rows, but do not create
-- a sale from gateway data alone because the cart/accounting payload lives in POS.

CREATE OR REPLACE FUNCTION public.reconcile_mobile_money_attempt(p_tx_ref text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt public.mobile_money_attempts%ROWTYPE;
  v_sale_id uuid;
  v_new_payment_status text;
  v_completed_paid numeric(15,2) := 0;
  v_sale_total numeric(15,2) := 0;
  v_sale_status text := 'pending';
  v_updated_payments integer := 0;
  v_updated_sale_payments integer := 0;
BEGIN
  SELECT *
    INTO v_attempt
    FROM public.mobile_money_attempts
   WHERE tx_ref = p_tx_ref;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'attempt_not_found');
  END IF;

  IF v_attempt.sale_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'no_sale_id');
  END IF;

  v_sale_id := v_attempt.sale_id;
  v_new_payment_status := CASE
    WHEN v_attempt.status = 'successful' THEN 'completed'
    WHEN v_attempt.status IN ('failed', 'cancelled', 'timeout') THEN 'failed'
    ELSE 'pending'
  END;

  UPDATE public.retail_sale_payments rsp
     SET payment_status = v_new_payment_status,
         reference = COALESCE(rsp.reference, v_attempt.tx_ref),
         paid_at = CASE WHEN v_new_payment_status = 'completed' THEN COALESCE(v_attempt.paid_at, now()) ELSE rsp.paid_at END
   WHERE rsp.sale_id = v_sale_id
     AND rsp.payment_method = v_attempt.payment_method
     AND round(rsp.amount::numeric, 2) = round(v_attempt.amount::numeric, 2)
     AND (rsp.reference IS NULL OR rsp.reference = v_attempt.tx_ref)
     AND rsp.payment_status IN ('pending', 'failed');
  GET DIAGNOSTICS v_updated_sale_payments = ROW_COUNT;

  UPDATE public.payments p
     SET payment_status = v_new_payment_status,
         paid_at = CASE WHEN v_new_payment_status = 'completed' THEN COALESCE(v_attempt.paid_at, now()) ELSE p.paid_at END,
         source_documents = COALESCE(p.source_documents, '{}'::jsonb) || jsonb_build_object(
           'mobile_money_tx_ref', v_attempt.tx_ref,
           'mobile_money_gateway', v_attempt.gateway_provider,
           'gateway_transaction_id', v_attempt.flutterwave_tx_id,
           'gateway_transaction_token', v_attempt.dpo_transaction_token,
           'gateway_transaction_ref', v_attempt.gateway_transaction_ref,
           'mobile_money_attempt_status', v_attempt.status
         )
   WHERE p.transaction_id = v_sale_id::text
     AND p.payment_method = v_attempt.payment_method
     AND round(p.amount::numeric, 2) = round(v_attempt.amount::numeric, 2)
     AND p.payment_status IN ('pending', 'failed');
  GET DIAGNOSTICS v_updated_payments = ROW_COUNT;

  SELECT COALESCE(total_amount, 0)
    INTO v_sale_total
    FROM public.retail_sales
   WHERE id = v_sale_id;

  SELECT COALESCE(SUM(amount), 0)
    INTO v_completed_paid
    FROM public.retail_sale_payments
   WHERE sale_id = v_sale_id
     AND payment_status = 'completed';

  v_sale_status := CASE
    WHEN v_completed_paid <= 0 THEN 'pending'
    WHEN v_completed_paid < v_sale_total THEN 'partial'
    WHEN v_completed_paid > v_sale_total THEN 'overpaid'
    ELSE 'completed'
  END;

  UPDATE public.retail_sales
     SET amount_paid = v_completed_paid,
         amount_due = GREATEST(v_sale_total - v_completed_paid, 0),
         payment_status = v_sale_status
   WHERE id = v_sale_id;

  RETURN jsonb_build_object(
    'ok', true,
    'status', v_attempt.status,
    'sale_id', v_sale_id,
    'payments_updated', v_updated_payments,
    'retail_sale_payments_updated', v_updated_sale_payments,
    'sale_payment_status', v_sale_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_mobile_money_attempt(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_mobile_money_attempt(text) TO service_role;

COMMENT ON FUNCTION public.reconcile_mobile_money_attempt(text) IS
  'Webhook-safe reconciliation for mobile_money_attempts to existing Retail POS payment rows.';
