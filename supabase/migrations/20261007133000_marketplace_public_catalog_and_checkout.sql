-- Public catalogue reads and a customer-safe order creation path.
-- Prices, publication status and commission are all verified here, rather than trusted from the browser.
CREATE POLICY marketplace_categories_public_read
  ON public.marketplace_categories FOR SELECT TO anon USING (is_active = true);

CREATE POLICY marketplace_merchant_profiles_public_read
  ON public.marketplace_merchant_profiles FOR SELECT TO anon, authenticated USING (is_published = true);

CREATE POLICY marketplace_listings_public_read
  ON public.marketplace_listings FOR SELECT TO anon, authenticated
  USING (
    is_published = true
    AND EXISTS (
      SELECT 1 FROM public.marketplace_merchant_profiles merchant
      WHERE merchant.id = marketplace_listings.merchant_id AND merchant.is_published = true
    )
  );

CREATE POLICY marketplace_orders_customer_read
  ON public.marketplace_orders FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.marketplace_customers customer
      WHERE customer.id = marketplace_orders.customer_id AND customer.user_id = auth.uid()
    )
  );

CREATE POLICY marketplace_order_items_customer_read
  ON public.marketplace_order_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.marketplace_orders order_row
      JOIN public.marketplace_customers customer ON customer.id = order_row.customer_id
      WHERE order_row.id = marketplace_order_items.order_id AND customer.user_id = auth.uid()
    )
  );

GRANT SELECT ON public.marketplace_categories, public.marketplace_merchant_profiles, public.marketplace_listings TO anon;

CREATE OR REPLACE FUNCTION public.marketplace_checkout(
  p_merchant_id uuid,
  p_lines jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id uuid;
  v_organization_id uuid;
  v_order_id uuid;
  v_order_number text;
  v_line jsonb;
  v_listing record;
  v_listing_id uuid;
  v_quantity numeric(15,3);
  v_line_total numeric(15,2);
  v_line_commission numeric(15,2);
  v_gross numeric(15,2) := 0;
  v_commission numeric(15,2) := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in before placing an order';
  END IF;

  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'An order needs at least one item';
  END IF;

  SELECT id INTO v_customer_id
  FROM public.marketplace_customers
  WHERE user_id = auth.uid();

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Create a marketplace customer profile before placing an order';
  END IF;

  SELECT organization_id INTO v_organization_id
  FROM public.marketplace_merchant_profiles
  WHERE id = p_merchant_id AND is_published = true;

  IF v_organization_id IS NULL THEN
    RAISE EXCEPTION 'This merchant is not available for marketplace orders';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    BEGIN
      v_listing_id := (v_line ->> 'listing_id')::uuid;
      v_quantity := (v_line ->> 'quantity')::numeric(15,3);
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Each order item must have a valid listing and quantity';
    END;

    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'Each order quantity must be greater than zero';
    END IF;

    SELECT listing.id, listing.organization_id, listing.category_id, listing.source_module,
           listing.source_record_id, listing.title, listing.price
      INTO v_listing
    FROM public.marketplace_listings listing
    JOIN public.marketplace_merchant_profiles merchant ON merchant.id = listing.merchant_id
    WHERE listing.id = v_listing_id
      AND listing.merchant_id = p_merchant_id
      AND listing.is_published = true
      AND merchant.is_published = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'One or more selected listings are unavailable';
    END IF;

    v_line_total := round(v_listing.price * v_quantity, 2);
    SELECT CASE rule.rule_type
      WHEN 'percentage' THEN round(v_line_total * rule.rate / 100, 2)
      ELSE rule.rate
    END
      INTO v_line_commission
    FROM public.marketplace_commission_rules rule
    WHERE rule.is_active = true
      AND rule.effective_from <= current_date
      AND (rule.effective_to IS NULL OR rule.effective_to >= current_date)
      AND (rule.organization_id IS NULL OR rule.organization_id = v_listing.organization_id)
      AND (rule.merchant_id IS NULL OR rule.merchant_id = p_merchant_id)
      AND (rule.category_id IS NULL OR rule.category_id = v_listing.category_id)
    ORDER BY (rule.merchant_id IS NOT NULL) DESC,
             (rule.organization_id IS NOT NULL) DESC,
             (rule.category_id IS NOT NULL) DESC,
             rule.effective_from DESC
    LIMIT 1;

    v_gross := v_gross + v_line_total;
    v_commission := v_commission + COALESCE(v_line_commission, 0);
  END LOOP;

  v_order_number := 'BM-' || to_char(current_timestamp, 'YYMMDD') || '-' || upper(substring(replace(gen_random_uuid()::text, '-', '') FROM 1 FOR 8));
  INSERT INTO public.marketplace_orders (
    order_number, organization_id, merchant_id, customer_id, status,
    gross_amount, platform_fee, merchant_amount
  ) VALUES (
    v_order_number, v_organization_id, p_merchant_id, v_customer_id, 'pending',
    v_gross, v_commission, v_gross - v_commission
  ) RETURNING id INTO v_order_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_listing_id := (v_line ->> 'listing_id')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric(15,3);
    SELECT id, source_module, source_record_id, title, price INTO v_listing
    FROM public.marketplace_listings
    WHERE id = v_listing_id AND merchant_id = p_merchant_id AND is_published = true;

    INSERT INTO public.marketplace_order_items (
      order_id, listing_id, title, quantity, unit_price, total_amount, source_module, source_record_id
    ) VALUES (
      v_order_id, v_listing.id, v_listing.title, v_quantity, v_listing.price,
      round(v_listing.price * v_quantity, 2), v_listing.source_module, v_listing.source_record_id
    );
  END LOOP;

  RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.marketplace_checkout(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marketplace_checkout(uuid, jsonb) TO authenticated;
