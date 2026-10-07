-- BOAT Market payment requests are separate from Retail POS mobile-money attempts.
CREATE TABLE IF NOT EXISTS public.marketplace_payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.marketplace_orders(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.marketplace_customers(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payment_reference text NOT NULL UNIQUE,
  provider text NOT NULL DEFAULT 'flutterwave',
  network text NOT NULL CHECK (network IN ('mtn', 'airtel')),
  phone_number text NOT NULL,
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'UGX',
  status text NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated', 'pending', 'successful', 'failed', 'timeout', 'cancelled')),
  gateway_transaction_id bigint,
  gateway_response jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_marketplace_payment_requests_order ON public.marketplace_payment_requests(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketplace_payment_requests_reference ON public.marketplace_payment_requests(payment_reference);
CREATE INDEX IF NOT EXISTS idx_marketplace_payment_requests_org_status ON public.marketplace_payment_requests(organization_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION public.touch_marketplace_payment_requests_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_marketplace_payment_requests_touch ON public.marketplace_payment_requests;
CREATE TRIGGER trg_marketplace_payment_requests_touch
  BEFORE UPDATE ON public.marketplace_payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_marketplace_payment_requests_updated_at();

ALTER TABLE public.marketplace_payment_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY marketplace_payment_requests_customer_read ON public.marketplace_payment_requests FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.marketplace_customers customer WHERE customer.id = customer_id AND customer.user_id = auth.uid()));
CREATE POLICY marketplace_payment_requests_org_read ON public.marketplace_payment_requests FOR SELECT TO authenticated
  USING (public.marketplace_org_access(organization_id));
GRANT SELECT ON public.marketplace_payment_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.marketplace_create_payment_request(
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
  v_existing record;
  v_reference text;
  v_phone text;
  v_payment_request_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in before requesting payment';
  END IF;
  IF p_network NOT IN ('mtn', 'airtel') THEN
    RAISE EXCEPTION 'Choose MTN or Airtel mobile money';
  END IF;
  v_phone := regexp_replace(trim(COALESCE(p_phone_number, '')), '[^0-9+]', '', 'g');
  IF length(v_phone) < 9 THEN
    RAISE EXCEPTION 'Enter a valid mobile money phone number';
  END IF;

  SELECT order_row.id, order_row.customer_id, order_row.organization_id, order_row.gross_amount, order_row.currency, order_row.status
    INTO v_order
  FROM public.marketplace_orders order_row
  JOIN public.marketplace_customers customer ON customer.id = order_row.customer_id
  WHERE order_row.id = p_order_id AND customer.user_id = auth.uid()
  FOR UPDATE OF order_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Marketplace order not found';
  END IF;
  IF v_order.status IN ('paid', 'fulfilled', 'cancelled', 'refunded') THEN
    RAISE EXCEPTION 'This order is not available for payment';
  END IF;

  SELECT id, payment_reference, amount, currency, status INTO v_existing
  FROM public.marketplace_payment_requests
  WHERE order_id = p_order_id AND status IN ('initiated', 'pending')
  ORDER BY created_at DESC
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'payment_request_id', v_existing.id,
      'payment_reference', v_existing.payment_reference,
      'amount', v_existing.amount,
      'currency', v_existing.currency,
      'status', v_existing.status
    );
  END IF;

  v_reference := 'BMP-' || to_char(current_timestamp, 'YYMMDD') || '-' || upper(substring(replace(gen_random_uuid()::text, '-', '') FROM 1 FOR 10));
  INSERT INTO public.marketplace_payment_requests (
    order_id, customer_id, organization_id, payment_reference, network, phone_number, amount, currency
  ) VALUES (
    v_order.id, v_order.customer_id, v_order.organization_id, v_reference, p_network, v_phone, v_order.gross_amount, v_order.currency
  ) RETURNING id INTO v_payment_request_id;

  UPDATE public.marketplace_orders SET payment_reference = v_reference WHERE id = v_order.id;
  RETURN jsonb_build_object(
    'payment_request_id', v_payment_request_id,
    'payment_reference', v_reference,
    'amount', v_order.gross_amount,
    'currency', v_order.currency,
    'status', 'initiated'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.marketplace_finalize_payment(
  p_payment_reference text,
  p_gateway_transaction_id bigint DEFAULT NULL,
  p_gateway_response jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.marketplace_payment_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_request FROM public.marketplace_payment_requests
  WHERE payment_reference = p_payment_reference
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Marketplace payment request not found';
  END IF;
  IF v_request.status <> 'successful' THEN
    UPDATE public.marketplace_payment_requests
    SET status = 'successful', gateway_transaction_id = COALESCE(p_gateway_transaction_id, gateway_transaction_id),
        gateway_response = COALESCE(p_gateway_response, gateway_response), paid_at = now(), last_error = NULL
    WHERE id = v_request.id;
  END IF;
  UPDATE public.marketplace_orders
  SET status = 'paid', payment_reference = v_request.payment_reference
  WHERE id = v_request.order_id;

  RETURN v_request.order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.marketplace_create_payment_request(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.marketplace_finalize_payment(text, bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marketplace_create_payment_request(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.marketplace_finalize_payment(text, bigint, jsonb) TO service_role;
