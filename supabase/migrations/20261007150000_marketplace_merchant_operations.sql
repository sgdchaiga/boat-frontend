-- Merchant workflow, inventory reservations and linked retail-product synchronisation.
ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS merchant_note text,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS fulfilled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_reason text;

-- Prevent direct client-side changes to marketplace order status. Merchant actions use the guarded RPC below.
DROP POLICY IF EXISTS marketplace_org_marketplace_orders ON public.marketplace_orders;
CREATE POLICY marketplace_orders_org_read ON public.marketplace_orders FOR SELECT TO authenticated
  USING (public.marketplace_org_access(organization_id));

CREATE OR REPLACE FUNCTION public.marketplace_refresh_listing_availability(p_listing_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing public.marketplace_listings%ROWTYPE;
  v_product_id uuid;
  v_track_inventory boolean;
  v_physical numeric(15,3);
  v_reserved numeric(15,3);
BEGIN
  SELECT * INTO v_listing FROM public.marketplace_listings WHERE id = p_listing_id;
  IF NOT FOUND OR v_listing.source_module <> 'retail_product' OR v_listing.source_record_id IS NULL THEN RETURN; END IF;

  BEGIN
    v_product_id := v_listing.source_record_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN;
  END;
  SELECT track_inventory INTO v_track_inventory FROM public.products WHERE id = v_product_id;
  IF v_track_inventory IS DISTINCT FROM true THEN
    UPDATE public.marketplace_listings SET available_quantity = NULL WHERE id = p_listing_id;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(COALESCE(quantity_in, 0) - COALESCE(quantity_out, 0)), 0)
    INTO v_physical
  FROM public.product_stock_movements
  WHERE organization_id = v_listing.organization_id AND product_id = v_product_id;
  SELECT COALESCE(SUM(item.quantity), 0)
    INTO v_reserved
  FROM public.marketplace_order_items item
  JOIN public.marketplace_orders order_row ON order_row.id = item.order_id
  WHERE item.listing_id = p_listing_id AND order_row.status IN ('pending', 'confirmed', 'paid');

  UPDATE public.marketplace_listings
  SET available_quantity = GREATEST(0, v_physical - v_reserved)
  WHERE id = p_listing_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.marketplace_listing_refresh_on_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.marketplace_refresh_listing_availability(NEW.id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_marketplace_listing_refresh_on_change ON public.marketplace_listings;
CREATE TRIGGER trg_marketplace_listing_refresh_on_change
  AFTER INSERT OR UPDATE OF source_module, source_record_id, title, price ON public.marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION public.marketplace_listing_refresh_on_change();

CREATE OR REPLACE FUNCTION public.marketplace_order_item_check_availability()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_available numeric(15,3); BEGIN
  SELECT available_quantity INTO v_available FROM public.marketplace_listings WHERE id = NEW.listing_id FOR UPDATE;
  IF v_available IS NOT NULL AND NEW.quantity > v_available THEN
    RAISE EXCEPTION 'Only % units remain available for this marketplace listing', v_available;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_marketplace_order_item_check_availability ON public.marketplace_order_items;
CREATE TRIGGER trg_marketplace_order_item_check_availability
  BEFORE INSERT ON public.marketplace_order_items
  FOR EACH ROW EXECUTE FUNCTION public.marketplace_order_item_check_availability();

CREATE OR REPLACE FUNCTION public.marketplace_order_item_refresh_availability()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.marketplace_refresh_listing_availability(OLD.listing_id);
    RETURN OLD;
  END IF;
  PERFORM public.marketplace_refresh_listing_availability(NEW.listing_id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_marketplace_order_item_refresh_availability ON public.marketplace_order_items;
CREATE TRIGGER trg_marketplace_order_item_refresh_availability
  AFTER INSERT OR UPDATE OR DELETE ON public.marketplace_order_items
  FOR EACH ROW EXECUTE FUNCTION public.marketplace_order_item_refresh_availability();

CREATE OR REPLACE FUNCTION public.marketplace_order_refresh_availability()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_listing_id uuid; BEGIN
  FOR v_listing_id IN SELECT listing_id FROM public.marketplace_order_items WHERE order_id = NEW.id AND listing_id IS NOT NULL LOOP
    PERFORM public.marketplace_refresh_listing_availability(v_listing_id);
  END LOOP;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_marketplace_order_refresh_availability ON public.marketplace_orders;
CREATE TRIGGER trg_marketplace_order_refresh_availability
  AFTER UPDATE OF status ON public.marketplace_orders
  FOR EACH ROW EXECUTE FUNCTION public.marketplace_order_refresh_availability();

CREATE OR REPLACE FUNCTION public.marketplace_sync_product_listing()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_listing_id uuid; BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.marketplace_listings
    SET is_published = false, available_quantity = 0
    WHERE organization_id = OLD.organization_id AND source_module = 'retail_product' AND source_record_id = OLD.id::text;
    RETURN OLD;
  END IF;

  UPDATE public.marketplace_listings
  SET title = NEW.name,
      price = COALESCE(NEW.sales_price, 0),
      is_published = CASE WHEN COALESCE(NEW.active, true) = false OR COALESCE(NEW.saleable, true) = false THEN false ELSE is_published END
  WHERE organization_id = NEW.organization_id AND source_module = 'retail_product' AND source_record_id = NEW.id::text;
  FOR v_listing_id IN SELECT id FROM public.marketplace_listings WHERE organization_id = NEW.organization_id AND source_module = 'retail_product' AND source_record_id = NEW.id::text LOOP
    PERFORM public.marketplace_refresh_listing_availability(v_listing_id);
  END LOOP;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_marketplace_sync_product_listing ON public.products;
CREATE TRIGGER trg_marketplace_sync_product_listing
  AFTER UPDATE OF name, sales_price, active, saleable, track_inventory OR DELETE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.marketplace_sync_product_listing();

CREATE OR REPLACE FUNCTION public.marketplace_sync_stock_listing()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid;
  v_product uuid;
  v_listing_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_org := OLD.organization_id;
    v_product := OLD.product_id;
  ELSE
    v_org := NEW.organization_id;
    v_product := NEW.product_id;
  END IF;
  FOR v_listing_id IN SELECT id FROM public.marketplace_listings WHERE organization_id = v_org AND source_module = 'retail_product' AND source_record_id = v_product::text LOOP
    PERFORM public.marketplace_refresh_listing_availability(v_listing_id);
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_marketplace_sync_stock_listing ON public.product_stock_movements;
CREATE TRIGGER trg_marketplace_sync_stock_listing
  AFTER INSERT OR UPDATE OR DELETE ON public.product_stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.marketplace_sync_stock_listing();

CREATE OR REPLACE FUNCTION public.marketplace_merchant_update_order_status(
  p_order_id uuid,
  p_action text,
  p_note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.marketplace_orders%ROWTYPE;
  v_item record;
  v_track_inventory boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in before managing marketplace orders'; END IF;
  SELECT * INTO v_order FROM public.marketplace_orders
  WHERE id = p_order_id AND public.marketplace_org_access(organization_id)
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Marketplace order not found'; END IF;

  IF p_action = 'confirm' THEN
    IF v_order.status IN ('cancelled', 'fulfilled', 'refunded') THEN RAISE EXCEPTION 'This order can no longer be confirmed'; END IF;
    UPDATE public.marketplace_orders
    SET status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END,
        confirmed_at = COALESCE(confirmed_at, now()),
        merchant_note = COALESCE(NULLIF(trim(p_note), ''), merchant_note)
    WHERE id = v_order.id;
    RETURN;
  END IF;

  IF p_action = 'fulfil' THEN
    IF v_order.status <> 'paid' THEN RAISE EXCEPTION 'Only paid marketplace orders can be fulfilled'; END IF;
    FOR v_item IN
      SELECT item.source_record_id, item.quantity, product.track_inventory, product.cost_price
      FROM public.marketplace_order_items item
      JOIN public.products product ON product.id::text = item.source_record_id AND product.organization_id = v_order.organization_id
      WHERE item.order_id = v_order.id AND item.source_module = 'retail_product'
    LOOP
      v_track_inventory := v_item.track_inventory;
      IF v_track_inventory IS DISTINCT FROM false THEN
        INSERT INTO public.product_stock_movements (organization_id, product_id, source_type, source_id, quantity_in, quantity_out, unit_cost, note, movement_date)
        SELECT v_order.organization_id, v_item.source_record_id::uuid, 'marketplace_order', v_order.id, 0, v_item.quantity, COALESCE(v_item.cost_price, 0), 'BOAT Market order ' || v_order.order_number, now()
        WHERE NOT EXISTS (
          SELECT 1 FROM public.product_stock_movements movement
          WHERE movement.organization_id = v_order.organization_id AND movement.source_type = 'marketplace_order'
            AND movement.source_id = v_order.id AND movement.product_id = v_item.source_record_id::uuid
        );
      END IF;
    END LOOP;
    UPDATE public.marketplace_orders
    SET status = 'fulfilled', confirmed_at = COALESCE(confirmed_at, now()), fulfilled_at = now(),
        merchant_note = COALESCE(NULLIF(trim(p_note), ''), merchant_note)
    WHERE id = v_order.id;
    RETURN;
  END IF;

  IF p_action = 'cancel' THEN
    IF v_order.status IN ('paid', 'fulfilled', 'refunded') THEN RAISE EXCEPTION 'Paid or fulfilled orders require the refunds workflow'; END IF;
    UPDATE public.marketplace_orders
    SET status = 'cancelled', cancelled_at = now(), cancelled_reason = NULLIF(trim(p_note), ''),
        merchant_note = COALESCE(NULLIF(trim(p_note), ''), merchant_note)
    WHERE id = v_order.id;
    RETURN;
  END IF;

  RAISE EXCEPTION 'Unsupported marketplace order action';
END;
$$;

REVOKE ALL ON FUNCTION public.marketplace_refresh_listing_availability(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.marketplace_merchant_update_order_status(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marketplace_merchant_update_order_status(uuid, text, text) TO authenticated;
