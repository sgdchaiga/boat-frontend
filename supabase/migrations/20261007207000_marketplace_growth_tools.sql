-- Shopper wishlists and merchant-managed promotion codes.
CREATE TABLE IF NOT EXISTS public.marketplace_wishlist_items (
  customer_id uuid NOT NULL REFERENCES public.marketplace_customers(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, listing_id)
);
ALTER TABLE public.marketplace_wishlist_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY marketplace_wishlist_items_self ON public.marketplace_wishlist_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.marketplace_customers customer WHERE customer.id = customer_id AND customer.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.marketplace_customers customer WHERE customer.id = customer_id AND customer.user_id = auth.uid()));
GRANT SELECT, INSERT, DELETE ON public.marketplace_wishlist_items TO authenticated;

CREATE TABLE IF NOT EXISTS public.marketplace_promotion_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES public.marketplace_merchant_profiles(id) ON DELETE CASCADE,
  code text NOT NULL,
  discount_type text NOT NULL CHECK (discount_type IN ('percentage','fixed')),
  discount_value numeric(15,2) NOT NULL CHECK (discount_value > 0),
  minimum_order_amount numeric(15,2) NOT NULL DEFAULT 0 CHECK (minimum_order_amount >= 0),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  usage_limit integer,
  usage_count integer NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, code)
);
ALTER TABLE public.marketplace_promotion_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY marketplace_promotion_codes_merchant ON public.marketplace_promotion_codes FOR ALL TO authenticated
  USING (public.marketplace_org_access(organization_id)) WITH CHECK (public.marketplace_org_access(organization_id));
CREATE POLICY marketplace_promotion_codes_public_read ON public.marketplace_promotion_codes FOR SELECT TO authenticated
  USING (is_active AND starts_at <= now() AND (ends_at IS NULL OR ends_at >= now()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketplace_promotion_codes TO authenticated;

ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS promotion_code text,
  ADD COLUMN IF NOT EXISTS promotion_discount numeric(15,2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.marketplace_apply_promotion_code(p_order_id uuid, p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order public.marketplace_orders%ROWTYPE; v_promo public.marketplace_promotion_codes%ROWTYPE; v_discount numeric(15,2);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in before applying a promotion code'; END IF;
  SELECT order_row.* INTO v_order FROM public.marketplace_orders order_row JOIN public.marketplace_customers c ON c.id=order_row.customer_id
  WHERE order_row.id=p_order_id AND c.user_id=auth.uid() FOR UPDATE;
  IF NOT FOUND OR v_order.status NOT IN ('pending','confirmed') THEN RAISE EXCEPTION 'This order cannot accept a promotion code'; END IF;
  IF v_order.promotion_code IS NOT NULL THEN RAISE EXCEPTION 'A promotion code has already been applied to this order'; END IF;
  SELECT * INTO v_promo FROM public.marketplace_promotion_codes
  WHERE merchant_id=v_order.merchant_id AND upper(code)=upper(trim(p_code)) AND is_active AND starts_at<=now()
    AND (ends_at IS NULL OR ends_at>=now()) AND (usage_limit IS NULL OR usage_count<usage_limit) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That promotion code is invalid or no longer available'; END IF;
  IF v_order.gross_amount < v_promo.minimum_order_amount THEN RAISE EXCEPTION 'This code requires an order of at least %', v_promo.minimum_order_amount; END IF;
  v_discount := CASE WHEN v_promo.discount_type='percentage' THEN round(v_order.gross_amount*v_promo.discount_value/100,2) ELSE v_promo.discount_value END;
  v_discount := least(v_discount,v_order.gross_amount);
  UPDATE public.marketplace_orders SET promotion_code=v_promo.code,promotion_discount=v_discount,gross_amount=gross_amount-v_discount,
    merchant_amount=greatest(merchant_amount-v_discount,0),metadata=metadata||jsonb_build_object('promotion_code',v_promo.code,'promotion_discount',v_discount)
  WHERE id=v_order.id;
  UPDATE public.marketplace_promotion_codes SET usage_count=usage_count+1 WHERE id=v_promo.id;
  RETURN jsonb_build_object('discount',v_discount,'gross_amount',v_order.gross_amount-v_discount,'currency',v_order.currency,'code',v_promo.code);
END; $$;
REVOKE ALL ON FUNCTION public.marketplace_apply_promotion_code(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marketplace_apply_promotion_code(uuid,text) TO authenticated;
