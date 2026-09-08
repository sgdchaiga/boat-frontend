-- Preserve the chronological integrity of stays even when a write does not use
-- the hotel_check_out_stay RPC. NOT VALID keeps legacy invalid rows from
-- blocking deployment while still enforcing the rule for new and changed rows.
ALTER TABLE public.stays
  DROP CONSTRAINT IF EXISTS stays_checkout_not_before_checkin;

ALTER TABLE public.stays
  ADD CONSTRAINT stays_checkout_not_before_checkin
  CHECK (actual_check_out IS NULL OR actual_check_out >= actual_check_in)
  NOT VALID;
