-- A checkout is entered as a local calendar date. Comparing the derived noon
-- timestamp with the precise check-in timestamp incorrectly rejected same-day
-- stays whose check-in happened after noon.
CREATE OR REPLACE FUNCTION public.hotel_check_out_stay(
  p_stay_id uuid,
  p_checkout_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stay public.stays%ROWTYPE;
  v_actor uuid := auth.uid();
  v_staff_actor uuid;
  v_timezone text;
  v_checkin_date date;
  v_checkout timestamptz;
  v_was_checked_out boolean;
BEGIN
  IF p_checkout_date IS NULL THEN RAISE EXCEPTION 'Checkout date is required.'; END IF;
  SELECT * INTO v_stay FROM public.stays WHERE id=p_stay_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stay not found.'; END IF;
  IF NOT public.is_platform_admin() AND NOT EXISTS (
    SELECT 1 FROM public.staff s
    WHERE s.id=v_actor AND s.organization_id=v_stay.organization_id AND COALESCE(s.is_active,true)
      AND s.role IN ('super_admin','admin','manager','receptionist','accountant','supervisor')
  ) THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Not authorized to check out this stay.'; END IF;
  SELECT id INTO v_staff_actor FROM public.staff WHERE id=v_actor AND organization_id=v_stay.organization_id;

  v_timezone := COALESCE((SELECT hotel_timezone FROM public.organizations WHERE id=v_stay.organization_id),'UTC');
  v_checkin_date := (v_stay.actual_check_in AT TIME ZONE v_timezone)::date;
  IF p_checkout_date < v_checkin_date THEN RAISE EXCEPTION 'Checkout cannot be before check-in.'; END IF;

  v_checkout := ((p_checkout_date::text || ' 12:00:00')::timestamp AT TIME ZONE v_timezone);
  IF p_checkout_date = v_checkin_date THEN
    v_checkout := GREATEST(v_checkout, v_stay.actual_check_in);
  END IF;
  v_was_checked_out := v_stay.actual_check_out IS NOT NULL;

  PERFORM 1 FROM public.rooms rm WHERE rm.id=v_stay.room_id FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_stay.organization_id::text || ':' || v_stay.room_id::text, 0));
  UPDATE public.stays SET actual_check_out=v_checkout, checked_out_by=v_staff_actor WHERE id=v_stay.id;
  IF NOT v_was_checked_out AND v_stay.reservation_id IS NOT NULL THEN
    UPDATE public.reservations SET status='checked_out' WHERE id=v_stay.reservation_id;
  END IF;
  IF NOT v_was_checked_out THEN
    UPDATE public.rooms SET status='cleaning' WHERE id=v_stay.room_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'stay_id', v_stay.id, 'actual_check_out', v_checkout);
END;
$$;
