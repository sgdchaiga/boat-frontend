-- Older failed included-breakfast attempts were inserted as pending before
-- entitlement validation. They have a room but neither a breakfast claim nor
-- a linked room-billing charge, so quarantine them from operational displays.
UPDATE public.kitchen_orders ko
SET order_status='failed'
WHERE ko.order_status='pending'
  AND ko.room_id IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM public.hotel_breakfast_claims c WHERE c.kitchen_order_id=ko.id)
  AND NOT EXISTS(SELECT 1 FROM public.billing b WHERE b.source_pos_order_id=ko.id);
