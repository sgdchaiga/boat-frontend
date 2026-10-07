-- Customer self-service, notifications and verified-buyer reviews for the marketplace launch.
CREATE TABLE IF NOT EXISTS public.marketplace_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.marketplace_customers(id) ON DELETE CASCADE,
  recipient_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.marketplace_orders(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_marketplace_notifications_recipient ON public.marketplace_notifications(recipient_user_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketplace_notifications_org ON public.marketplace_notifications(organization_id, read_at, created_at DESC);

CREATE TABLE IF NOT EXISTS public.marketplace_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES public.marketplace_merchant_profiles(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.marketplace_orders(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES public.marketplace_order_items(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.marketplace_customers(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  is_published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_reviews_order_item_unique UNIQUE(order_item_id)
);
CREATE INDEX IF NOT EXISTS idx_marketplace_reviews_listing ON public.marketplace_reviews(listing_id, is_published, created_at DESC);

CREATE OR REPLACE FUNCTION public.touch_marketplace_reviews_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_marketplace_reviews_touch ON public.marketplace_reviews;
CREATE TRIGGER trg_marketplace_reviews_touch BEFORE UPDATE ON public.marketplace_reviews FOR EACH ROW EXECUTE FUNCTION public.touch_marketplace_reviews_updated_at();

ALTER TABLE public.marketplace_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY marketplace_notifications_customer_read ON public.marketplace_notifications FOR SELECT TO authenticated
  USING (recipient_user_id = auth.uid());
CREATE POLICY marketplace_notifications_org_read ON public.marketplace_notifications FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND public.marketplace_org_access(organization_id));
CREATE POLICY marketplace_reviews_public_read ON public.marketplace_reviews FOR SELECT TO anon, authenticated USING (is_published = true);
CREATE POLICY marketplace_reviews_org_read ON public.marketplace_reviews FOR SELECT TO authenticated USING (public.marketplace_org_access(organization_id));
CREATE POLICY marketplace_reviews_customer_read ON public.marketplace_reviews FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.marketplace_customers customer WHERE customer.id = customer_id AND customer.user_id = auth.uid()));
GRANT SELECT ON public.marketplace_notifications, public.marketplace_reviews TO authenticated;
GRANT SELECT ON public.marketplace_reviews TO anon;

CREATE OR REPLACE FUNCTION public.marketplace_notify_order_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id uuid; BEGIN
  SELECT user_id INTO v_user_id FROM public.marketplace_customers WHERE id = NEW.customer_id;
  IF v_user_id IS NOT NULL THEN
    INSERT INTO public.marketplace_notifications (organization_id, customer_id, recipient_user_id, order_id, notification_type, title, body)
    VALUES (NEW.organization_id, NEW.customer_id, v_user_id, NEW.id, 'order_created', 'Marketplace order placed', 'Order ' || NEW.order_number || ' has been received.');
  END IF;
  INSERT INTO public.marketplace_notifications (organization_id, order_id, notification_type, title, body)
  VALUES (NEW.organization_id, NEW.id, 'merchant_order_created', 'New marketplace order', 'Order ' || NEW.order_number || ' needs review.');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_marketplace_notify_order_created ON public.marketplace_orders;
CREATE TRIGGER trg_marketplace_notify_order_created AFTER INSERT ON public.marketplace_orders
  FOR EACH ROW EXECUTE FUNCTION public.marketplace_notify_order_created();

CREATE OR REPLACE FUNCTION public.marketplace_notify_order_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id uuid; v_title text; BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  SELECT user_id INTO v_user_id FROM public.marketplace_customers WHERE id = NEW.customer_id;
  IF v_user_id IS NULL THEN RETURN NEW; END IF;
  v_title := CASE NEW.status
    WHEN 'confirmed' THEN 'Marketplace order confirmed'
    WHEN 'paid' THEN 'Marketplace payment confirmed'
    WHEN 'fulfilled' THEN 'Marketplace order fulfilled'
    WHEN 'cancelled' THEN 'Marketplace order cancelled'
    WHEN 'refunded' THEN 'Marketplace order refunded'
    ELSE 'Marketplace order updated' END;
  INSERT INTO public.marketplace_notifications (organization_id, customer_id, recipient_user_id, order_id, notification_type, title, body)
  VALUES (NEW.organization_id, NEW.customer_id, v_user_id, NEW.id, 'order_' || NEW.status, v_title, 'Order ' || NEW.order_number || ' is now ' || NEW.status || '.');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_marketplace_notify_order_status ON public.marketplace_orders;
CREATE TRIGGER trg_marketplace_notify_order_status AFTER UPDATE OF status ON public.marketplace_orders
  FOR EACH ROW EXECUTE FUNCTION public.marketplace_notify_order_status();

CREATE OR REPLACE FUNCTION public.marketplace_notify_refund()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id uuid; v_number text; BEGIN
  SELECT customer.user_id, order_row.order_number INTO v_user_id, v_number
  FROM public.marketplace_orders order_row JOIN public.marketplace_customers customer ON customer.id = order_row.customer_id
  WHERE order_row.id = NEW.order_id;
  IF v_user_id IS NOT NULL AND NEW.status = 'paid' THEN
    INSERT INTO public.marketplace_notifications (organization_id, customer_id, recipient_user_id, order_id, notification_type, title, body)
    VALUES (NEW.organization_id, NEW.customer_id, v_user_id, NEW.order_id, 'refund_paid', 'Marketplace refund recorded', 'A refund of ' || NEW.amount || ' ' || NEW.currency || ' was recorded for order ' || v_number || '.');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_marketplace_notify_refund ON public.marketplace_refunds;
CREATE TRIGGER trg_marketplace_notify_refund AFTER INSERT ON public.marketplace_refunds
  FOR EACH ROW EXECUTE FUNCTION public.marketplace_notify_refund();

CREATE OR REPLACE FUNCTION public.marketplace_mark_notification_read(p_notification_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.marketplace_notifications SET read_at = COALESCE(read_at, now())
  WHERE id = p_notification_id AND recipient_user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Marketplace notification not found'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.marketplace_mark_organization_notification_read(p_notification_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.marketplace_notifications notification
  SET read_at = COALESCE(notification.read_at, now())
  WHERE notification.id = p_notification_id
    AND notification.recipient_user_id IS NULL
    AND notification.organization_id IS NOT NULL
    AND public.marketplace_org_access(notification.organization_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Marketplace notification not found'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.marketplace_submit_review(p_order_item_id uuid, p_rating integer, p_comment text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_item record; v_review_id uuid; BEGIN
  IF p_rating NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Choose a rating from 1 to 5'; END IF;
  SELECT item.id, item.listing_id, order_row.id AS order_id, order_row.organization_id, order_row.merchant_id, order_row.customer_id
    INTO v_item
  FROM public.marketplace_order_items item
  JOIN public.marketplace_orders order_row ON order_row.id = item.order_id
  JOIN public.marketplace_customers customer ON customer.id = order_row.customer_id
  WHERE item.id = p_order_item_id AND customer.user_id = auth.uid() AND order_row.status = 'fulfilled' AND item.listing_id IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only a fulfilled item from your order can be reviewed'; END IF;
  INSERT INTO public.marketplace_reviews (organization_id, merchant_id, listing_id, order_id, order_item_id, customer_id, rating, comment)
  VALUES (v_item.organization_id, v_item.merchant_id, v_item.listing_id, v_item.order_id, v_item.customer_id, p_rating, NULLIF(trim(COALESCE(p_comment, '')), ''))
  ON CONFLICT (order_item_id) DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, updated_at = now()
  RETURNING id INTO v_review_id;
  RETURN v_review_id;
END;
$$;

CREATE OR REPLACE VIEW public.marketplace_listing_review_summary AS
  SELECT listing_id, COUNT(*)::integer AS review_count, ROUND(AVG(rating)::numeric, 1) AS average_rating
  FROM public.marketplace_reviews
  WHERE is_published = true
  GROUP BY listing_id;
GRANT SELECT ON public.marketplace_listing_review_summary TO anon, authenticated;

REVOKE ALL ON FUNCTION public.marketplace_mark_notification_read(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.marketplace_mark_organization_notification_read(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.marketplace_submit_review(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marketplace_mark_notification_read(uuid), public.marketplace_mark_organization_notification_read(uuid), public.marketplace_submit_review(uuid, integer, text) TO authenticated;
