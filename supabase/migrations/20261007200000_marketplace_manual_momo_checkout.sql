-- Manual Mobile Money checkout: the customer pays from their own MoMo menu,
-- submits the provider transaction ID, and an organisation administrator verifies it.

CREATE OR REPLACE FUNCTION public.marketplace_admin_access(p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_admin()
    OR EXISTS (
      SELECT 1
      FROM public.staff staff_row
      WHERE staff_row.id = auth.uid()
        AND staff_row.organization_id = p_org
        AND lower(COALESCE(staff_row.role, '')) IN ('admin', 'super_admin')
    )
$$;

CREATE TABLE IF NOT EXISTS public.marketplace_manual_momo_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  recipient_name text NOT NULL DEFAULT '',
  recipient_phone text NOT NULL DEFAULT '',
  recipient_network text NOT NULL DEFAULT 'mtn' CHECK (recipient_network IN ('mtn', 'airtel')),
  payment_instructions text,
  is_active boolean NOT NULL DEFAULT false,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.marketplace_manual_momo_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY marketplace_manual_momo_settings_admin
  ON public.marketplace_manual_momo_settings FOR ALL TO authenticated
  USING (public.marketplace_admin_access(organization_id))
  WITH CHECK (public.marketplace_admin_access(organization_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketplace_manual_momo_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.touch_marketplace_manual_momo_settings_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_marketplace_manual_momo_settings_touch ON public.marketplace_manual_momo_settings;
CREATE TRIGGER trg_marketplace_manual_momo_settings_touch
  BEFORE UPDATE ON public.marketplace_manual_momo_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_marketplace_manual_momo_settings_updated_at();

ALTER TABLE public.marketplace_payment_requests
  ADD COLUMN IF NOT EXISTS manual_transaction_id text,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by uuid,
  ADD COLUMN IF NOT EXISTS verification_note text;

ALTER TABLE public.marketplace_payment_requests
  DROP CONSTRAINT IF EXISTS marketplace_payment_requests_status_check;
ALTER TABLE public.marketplace_payment_requests
  ADD CONSTRAINT marketplace_payment_requests_status_check
  CHECK (status IN ('initiated', 'awaiting_submission', 'submitted', 'pending', 'successful', 'failed', 'timeout', 'cancelled', 'rejected'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_manual_momo_transaction_unique
  ON public.marketplace_payment_requests (lower(manual_transaction_id))
  WHERE manual_transaction_id IS NOT NULL AND provider = 'manual_momo';
CREATE INDEX IF NOT EXISTS idx_marketplace_manual_momo_verification_queue
  ON public.marketplace_payment_requests (organization_id, status, submitted_at DESC)
  WHERE provider = 'manual_momo';

CREATE TABLE IF NOT EXISTS public.marketplace_commission_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.marketplace_orders(id) ON DELETE RESTRICT,
  payment_request_id uuid NOT NULL REFERENCES public.marketplace_payment_requests(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES public.marketplace_merchant_profiles(id) ON DELETE RESTRICT,
  gross_amount numeric(15,2) NOT NULL CHECK (gross_amount >= 0),
  commission_amount numeric(15,2) NOT NULL CHECK (commission_amount >= 0),
  currency text NOT NULL DEFAULT 'UGX',
  status text NOT NULL DEFAULT 'earned' CHECK (status IN ('earned', 'reversed')),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid,
  note text
);
CREATE INDEX IF NOT EXISTS idx_marketplace_commission_records_org
  ON public.marketplace_commission_records (organization_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketplace_commission_records_merchant
  ON public.marketplace_commission_records (merchant_id, recorded_at DESC);

ALTER TABLE public.marketplace_commission_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY marketplace_commission_records_org_read
  ON public.marketplace_commission_records FOR SELECT TO authenticated
  USING (public.marketplace_org_access(organization_id));
GRANT SELECT ON public.marketplace_commission_records TO authenticated;

CREATE OR REPLACE FUNCTION public.marketplace_start_manual_momo_payment(
  p_order_id uuid,
  p_phone_number text,
  p_network text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_customer record;
  v_setting public.marketplace_manual_momo_settings%ROWTYPE;
  v_existing public.marketplace_payment_requests%ROWTYPE;
  v_reference text;
  v_phone text;
  v_request_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in before starting a manual MoMo payment';
  END IF;
  IF p_network NOT IN ('mtn', 'airtel') THEN
    RAISE EXCEPTION 'Choose the mobile money network you are paying from';
  END IF;

  SELECT order_row.id, order_row.order_number, order_row.customer_id, order_row.organization_id,
         order_row.gross_amount, order_row.currency, order_row.status
    INTO v_order
  FROM public.marketplace_orders order_row
  JOIN public.marketplace_customers customer ON customer.id = order_row.customer_id
  WHERE order_row.id = p_order_id
    AND customer.user_id = auth.uid()
    AND public.marketplace_organization_enabled(order_row.organization_id)
  FOR UPDATE OF order_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Marketplace order not found';
  END IF;
  IF v_order.status IN ('paid', 'fulfilled', 'cancelled', 'refunded') THEN
    RAISE EXCEPTION 'This order is not available for payment';
  END IF;

  SELECT * INTO v_setting
  FROM public.marketplace_manual_momo_settings
  WHERE organization_id = v_order.organization_id
    AND is_active = true;
  IF NOT FOUND OR NULLIF(trim(v_setting.recipient_name), '') IS NULL OR NULLIF(trim(v_setting.recipient_phone), '') IS NULL THEN
    RAISE EXCEPTION 'This merchant has not configured manual Mobile Money payment details yet';
  END IF;

  SELECT phone INTO v_customer
  FROM public.marketplace_customers
  WHERE id = v_order.customer_id;
  v_phone := regexp_replace(trim(COALESCE(NULLIF(p_phone_number, ''), v_customer.phone, '')), '[^0-9+]', '', 'g');
  IF length(v_phone) < 9 THEN
    RAISE EXCEPTION 'Enter the mobile money number you are paying from';
  END IF;

  SELECT * INTO v_existing
  FROM public.marketplace_payment_requests
  WHERE order_id = v_order.id
    AND provider = 'manual_momo'
    AND status IN ('awaiting_submission', 'submitted')
  ORDER BY created_at DESC
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'payment_request_id', v_existing.id,
      'order_reference', v_order.order_number,
      'payment_reference', v_existing.payment_reference,
      'amount', v_existing.amount,
      'currency', v_existing.currency,
      'status', v_existing.status,
      'recipient_name', v_setting.recipient_name,
      'recipient_phone', v_setting.recipient_phone,
      'recipient_network', v_setting.recipient_network,
      'payment_instructions', v_setting.payment_instructions
    );
  END IF;

  v_reference := 'BMM-' || to_char(current_timestamp, 'YYMMDD') || '-' || upper(substring(replace(gen_random_uuid()::text, '-', '') FROM 1 FOR 10));
  INSERT INTO public.marketplace_payment_requests (
    order_id, customer_id, organization_id, payment_reference, provider, network, phone_number,
    amount, currency, status
  ) VALUES (
    v_order.id, v_order.customer_id, v_order.organization_id, v_reference, 'manual_momo', p_network, v_phone,
    v_order.gross_amount, v_order.currency, 'awaiting_submission'
  ) RETURNING id INTO v_request_id;

  UPDATE public.marketplace_orders
  SET payment_reference = v_reference
  WHERE id = v_order.id;

  RETURN jsonb_build_object(
    'payment_request_id', v_request_id,
    'order_reference', v_order.order_number,
    'payment_reference', v_reference,
    'amount', v_order.gross_amount,
    'currency', v_order.currency,
    'status', 'awaiting_submission',
    'recipient_name', v_setting.recipient_name,
    'recipient_phone', v_setting.recipient_phone,
    'recipient_network', v_setting.recipient_network,
    'payment_instructions', v_setting.payment_instructions
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.marketplace_submit_manual_momo_transaction(
  p_payment_request_id uuid,
  p_transaction_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.marketplace_payment_requests%ROWTYPE;
  v_transaction_id text;
  v_order_number text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in before submitting a MoMo transaction ID';
  END IF;
  v_transaction_id := upper(regexp_replace(trim(COALESCE(p_transaction_id, '')), '\s+', '', 'g'));
  IF length(v_transaction_id) < 4 OR length(v_transaction_id) > 80 THEN
    RAISE EXCEPTION 'Enter the Mobile Money transaction ID exactly as shown in your payment message';
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
  IF EXISTS (
    SELECT 1
    FROM public.marketplace_payment_requests duplicate_request
    WHERE duplicate_request.provider = 'manual_momo'
      AND lower(duplicate_request.manual_transaction_id) = lower(v_transaction_id)
      AND duplicate_request.id <> v_request.id
  ) THEN
    RAISE EXCEPTION 'That Mobile Money transaction ID has already been submitted';
  END IF;

  UPDATE public.marketplace_payment_requests
  SET status = 'submitted', manual_transaction_id = v_transaction_id, submitted_at = now(),
      submitted_by = auth.uid(), verified_at = NULL, verified_by = NULL, verification_note = NULL,
      last_error = NULL,
      gateway_response = jsonb_build_object('manual_momo', true, 'transaction_id', v_transaction_id, 'submitted_at', now())
  WHERE id = v_request.id;

  SELECT order_number INTO v_order_number FROM public.marketplace_orders WHERE id = v_request.order_id;
  INSERT INTO public.marketplace_notifications (organization_id, order_id, notification_type, title, body)
  VALUES (
    v_request.organization_id,
    v_request.order_id,
    'manual_momo_submitted',
    'Manual MoMo verification required',
    'Order ' || v_order_number || ' has transaction ID ' || v_transaction_id || ' awaiting verification.'
  );

  RETURN jsonb_build_object('status', 'submitted', 'payment_reference', v_request.payment_reference, 'order_reference', v_order_number);
END;
$$;

CREATE OR REPLACE FUNCTION public.marketplace_verify_manual_momo_payment(
  p_payment_request_id uuid,
  p_approved boolean,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.marketplace_payment_requests%ROWTYPE;
  v_order public.marketplace_orders%ROWTYPE;
  v_customer_user_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in before verifying a manual MoMo payment';
  END IF;

  SELECT request_row.* INTO v_request
  FROM public.marketplace_payment_requests request_row
  WHERE request_row.id = p_payment_request_id
    AND request_row.provider = 'manual_momo'
  FOR UPDATE;
  IF NOT FOUND OR NOT public.marketplace_admin_access(v_request.organization_id) THEN
    RAISE EXCEPTION 'Manual Mobile Money payment request not found';
  END IF;
  IF v_request.status = 'successful' THEN
    RETURN jsonb_build_object('status', 'successful', 'order_id', v_request.order_id, 'payment_reference', v_request.payment_reference);
  END IF;
  IF v_request.status <> 'submitted' THEN
    RAISE EXCEPTION 'Only submitted manual payments can be verified';
  END IF;

  SELECT * INTO v_order FROM public.marketplace_orders WHERE id = v_request.order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Marketplace order not found';
  END IF;

  IF NOT p_approved THEN
    IF NULLIF(trim(COALESCE(p_note, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Give the customer a reason when rejecting a transaction ID';
    END IF;
    UPDATE public.marketplace_payment_requests
    SET status = 'rejected', verified_at = now(), verified_by = auth.uid(),
        verification_note = trim(p_note), last_error = trim(p_note)
    WHERE id = v_request.id;
    SELECT user_id INTO v_customer_user_id FROM public.marketplace_customers WHERE id = v_request.customer_id;
    IF v_customer_user_id IS NOT NULL THEN
      INSERT INTO public.marketplace_notifications (organization_id, customer_id, recipient_user_id, order_id, notification_type, title, body)
      VALUES (
        v_request.organization_id, v_request.customer_id, v_customer_user_id, v_request.order_id,
        'manual_momo_rejected', 'Manual MoMo payment needs attention',
        'The submitted transaction ID for order ' || v_order.order_number || ' was not verified: ' || trim(p_note)
      );
    END IF;
    RETURN jsonb_build_object('status', 'rejected', 'order_id', v_request.order_id, 'payment_reference', v_request.payment_reference);
  END IF;

  IF v_order.status IN ('cancelled', 'refunded') THEN
    RAISE EXCEPTION 'This order can no longer be paid';
  END IF;

  UPDATE public.marketplace_payment_requests
  SET status = 'successful', verified_at = now(), verified_by = auth.uid(),
      verification_note = NULLIF(trim(COALESCE(p_note, '')), ''), paid_at = now(), last_error = NULL,
      gateway_response = COALESCE(gateway_response, '{}'::jsonb) || jsonb_build_object('manual_momo', true, 'verified_at', now(), 'verified_by', auth.uid())
  WHERE id = v_request.id;

  UPDATE public.marketplace_orders
  SET status = 'paid', payment_reference = v_request.payment_reference
  WHERE id = v_order.id;

  INSERT INTO public.marketplace_commission_records (
    order_id, payment_request_id, organization_id, merchant_id, gross_amount,
    commission_amount, currency, recorded_by, note
  ) VALUES (
    v_order.id, v_request.id, v_order.organization_id, v_order.merchant_id, v_order.gross_amount,
    v_order.platform_fee, v_order.currency, auth.uid(), 'Manual MoMo verified'
  ) ON CONFLICT (order_id) DO NOTHING;

  RETURN jsonb_build_object(
    'status', 'successful',
    'order_id', v_order.id,
    'payment_reference', v_request.payment_reference,
    'commission_amount', v_order.platform_fee,
    'currency', v_order.currency
  );
END;
$$;

REVOKE ALL ON FUNCTION public.marketplace_start_manual_momo_payment(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.marketplace_submit_manual_momo_transaction(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.marketplace_verify_manual_momo_payment(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marketplace_start_manual_momo_payment(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.marketplace_submit_manual_momo_transaction(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.marketplace_verify_manual_momo_payment(uuid, boolean, text) TO authenticated;
