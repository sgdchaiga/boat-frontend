ALTER TABLE public.billing
  ADD COLUMN IF NOT EXISTS source_pos_order_id uuid REFERENCES public.kitchen_orders(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS billing_source_pos_order_unique
  ON public.billing(source_pos_order_id) WHERE source_pos_order_id IS NOT NULL;

-- Link historical bill-to-room orders where the order and folio charge were
-- created for the same room, timestamp and amount. Ambiguous matches are left alone.
WITH candidates AS (
  SELECT b.id billing_id, ko.id order_id,
         count(*) OVER (PARTITION BY b.id) match_count
  FROM public.billing b
  JOIN public.stays s ON s.id=b.stay_id
  JOIN public.kitchen_orders ko ON ko.room_id=s.room_id AND ko.created_at=b.charged_at
  JOIN LATERAL (
    SELECT round(COALESCE(sum(koi.quantity*COALESCE(koi.unit_price,p.sales_price,0)),0),2) total
    FROM public.kitchen_order_items koi LEFT JOIN public.products p ON p.id=koi.product_id
    WHERE koi.order_id=ko.id
  ) amount ON amount.total=round(b.amount,2)
  WHERE b.charge_type='food' AND b.source_pos_order_id IS NULL
)
UPDATE public.billing b SET source_pos_order_id=c.order_id
FROM candidates c WHERE b.id=c.billing_id AND c.match_count=1;
