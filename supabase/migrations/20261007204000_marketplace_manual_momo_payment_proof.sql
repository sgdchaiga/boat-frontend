-- Buyers may notify BOAT of a manual MoMo payment with a transaction ID, a payment-proof
-- document, or both. The proof remains private to the buyer and the verifying merchant.
ALTER TABLE public.marketplace_payment_requests
  ADD COLUMN IF NOT EXISTS payment_proof_path text,
  ADD COLUMN IF NOT EXISTS payment_proof_name text,
  ADD COLUMN IF NOT EXISTS payment_proof_uploaded_at timestamptz;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'marketplace-payment-proofs',
  'marketplace-payment-proofs',
  false,
  10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS marketplace_payment_proofs_customer_or_admin_read ON storage.objects;
CREATE POLICY marketplace_payment_proofs_customer_or_admin_read
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'marketplace-payment-proofs'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR EXISTS (
        SELECT 1
        FROM public.marketplace_payment_requests payment_request
        WHERE payment_request.payment_proof_path = name
          AND public.marketplace_admin_access(payment_request.organization_id)
      )
    )
  );

DROP POLICY IF EXISTS marketplace_payment_proofs_customer_insert ON storage.objects;
CREATE POLICY marketplace_payment_proofs_customer_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'marketplace-payment-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS marketplace_payment_proofs_customer_delete ON storage.objects;
CREATE POLICY marketplace_payment_proofs_customer_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'marketplace-payment-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE OR REPLACE FUNCTION public.marketplace_submit_manual_momo_payment_alert(
  p_payment_request_id uuid,
  p_transaction_id text DEFAULT NULL,
  p_proof_path text DEFAULT NULL,
  p_proof_name text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.marketplace_payment_requests%ROWTYPE;
  v_transaction_id text;
  v_proof_path text;
  v_order_number text;
  v_alert_details text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in before alerting BOAT about a MoMo payment';
  END IF;

  v_transaction_id := NULLIF(upper(regexp_replace(trim(COALESCE(p_transaction_id, '')), '\s+', '', 'g')), '');
  v_proof_path := NULLIF(trim(COALESCE(p_proof_path, '')), '');
  IF v_transaction_id IS NULL AND v_proof_path IS NULL THEN
    RAISE EXCEPTION 'Enter a Mobile Money transaction ID, attach payment proof, or provide both';
  END IF;
  IF v_transaction_id IS NOT NULL AND (length(v_transaction_id) < 4 OR length(v_transaction_id) > 80) THEN
    RAISE EXCEPTION 'Enter the Mobile Money transaction ID exactly as shown in your payment message';
  END IF;
  IF v_proof_path IS NOT NULL AND v_proof_path !~ ('^' || auth.uid()::text || '/') THEN
    RAISE EXCEPTION 'Payment proof must be uploaded by the signed-in buyer';
  END IF;

  SELECT request_row.* INTO v_request
  FROM public.marketplace_payment_requests request_row
  JOIN public.marketplace_customers customer ON customer.id = request_row.customer_id
  WHERE request_row.id = p_payment_request_id
    AND request_row.provider = 'manual_momo'
    AND customer.user_id = auth.uid()
  FOR UPDATE OF request_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Manual Mobile Money payment request not found';
  END IF;
  IF v_request.status = 'successful' THEN
    RAISE EXCEPTION 'This payment has already been verified';
  END IF;
  IF v_request.status NOT IN ('awaiting_submission', 'rejected') THEN
    RAISE EXCEPTION 'This payment is already awaiting administrator verification';
  END IF;
  IF v_transaction_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.marketplace_payment_requests duplicate_request
    WHERE duplicate_request.provider = 'manual_momo'
      AND lower(duplicate_request.manual_transaction_id) = lower(v_transaction_id)
      AND duplicate_request.id <> v_request.id
  ) THEN
    RAISE EXCEPTION 'That Mobile Money transaction ID has already been submitted';
  END IF;

  UPDATE public.marketplace_payment_requests
  SET status = 'submitted',
      manual_transaction_id = COALESCE(v_transaction_id, manual_transaction_id),
      payment_proof_path = COALESCE(v_proof_path, payment_proof_path),
      payment_proof_name = CASE WHEN v_proof_path IS NULL THEN payment_proof_name ELSE NULLIF(trim(COALESCE(p_proof_name, '')), '') END,
      payment_proof_uploaded_at = CASE WHEN v_proof_path IS NULL THEN payment_proof_uploaded_at ELSE now() END,
      submitted_at = now(), submitted_by = auth.uid(), verified_at = NULL, verified_by = NULL,
      verification_note = NULL, last_error = NULL,
      gateway_response = jsonb_build_object(
        'manual_momo', true,
        'transaction_id', v_transaction_id,
        'payment_proof_path', v_proof_path,
        'submitted_at', now()
      )
  WHERE id = v_request.id;

  SELECT order_number INTO v_order_number FROM public.marketplace_orders WHERE id = v_request.order_id;
  v_alert_details := CASE
    WHEN v_transaction_id IS NOT NULL AND v_proof_path IS NOT NULL THEN 'a transaction ID and payment proof'
    WHEN v_transaction_id IS NOT NULL THEN 'transaction ID ' || v_transaction_id
    ELSE 'a payment-proof document'
  END;
  INSERT INTO public.marketplace_notifications (organization_id, order_id, notification_type, title, body)
  VALUES (
    v_request.organization_id,
    v_request.order_id,
    'manual_momo_submitted',
    'Manual MoMo verification required',
    'Order ' || v_order_number || ' has ' || v_alert_details || ' awaiting verification.'
  );

  RETURN jsonb_build_object(
    'status', 'submitted',
    'payment_reference', v_request.payment_reference,
    'order_reference', v_order_number
  );
END;
$$;

REVOKE ALL ON FUNCTION public.marketplace_submit_manual_momo_payment_alert(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marketplace_submit_manual_momo_payment_alert(uuid, text, text, text) TO authenticated;
