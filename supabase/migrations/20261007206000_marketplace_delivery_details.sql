-- Customer delivery instructions are stored on the order so the merchant can fulfil a sale
-- without depending on an unstructured chat message.
ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS delivery_method text NOT NULL DEFAULT 'pickup',
  ADD COLUMN IF NOT EXISTS delivery_address text,
  ADD COLUMN IF NOT EXISTS delivery_phone text,
  ADD COLUMN IF NOT EXISTS delivery_note text;

ALTER TABLE public.marketplace_orders
  DROP CONSTRAINT IF EXISTS marketplace_orders_delivery_method_check;
ALTER TABLE public.marketplace_orders
  ADD CONSTRAINT marketplace_orders_delivery_method_check
  CHECK (delivery_method IN ('pickup', 'delivery'));

CREATE OR REPLACE FUNCTION public.marketplace_set_order_delivery(
  p_order_id uuid,
  p_delivery_method text DEFAULT 'pickup',
  p_delivery_address text DEFAULT NULL,
  p_delivery_phone text DEFAULT NULL,
  p_delivery_note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in before setting delivery details'; END IF;
  IF p_delivery_method NOT IN ('pickup', 'delivery') THEN RAISE EXCEPTION 'Choose pickup or delivery'; END IF;
  SELECT order_row.customer_id INTO v_customer_id
  FROM public.marketplace_orders order_row
  JOIN public.marketplace_customers customer ON customer.id = order_row.customer_id
  WHERE order_row.id = p_order_id
    AND customer.user_id = auth.uid()
    AND order_row.status IN ('pending', 'confirmed');
  IF v_customer_id IS NULL THEN RAISE EXCEPTION 'Marketplace order not available for delivery details'; END IF;
  IF p_delivery_method = 'delivery' AND (NULLIF(trim(COALESCE(p_delivery_address, '')), '') IS NULL OR NULLIF(trim(COALESCE(p_delivery_phone, '')), '') IS NULL) THEN
    RAISE EXCEPTION 'Enter a delivery address and phone number';
  END IF;
  UPDATE public.marketplace_orders
  SET delivery_method = p_delivery_method,
      delivery_address = NULLIF(trim(COALESCE(p_delivery_address, '')), ''),
      delivery_phone = NULLIF(trim(COALESCE(p_delivery_phone, '')), ''),
      delivery_note = NULLIF(trim(COALESCE(p_delivery_note, '')), '')
  WHERE id = p_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.marketplace_set_order_delivery(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marketplace_set_order_delivery(uuid, text, text, text, text) TO authenticated;
