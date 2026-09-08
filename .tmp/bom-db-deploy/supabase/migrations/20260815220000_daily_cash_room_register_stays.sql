-- Cash Room Register is a day-by-day register. Each saved room-day is closed
-- automatically at the start of the following room-day; multi-day guests are
-- recorded manually once for every date.
CREATE OR REPLACE FUNCTION public.save_daily_cash_room_register_customer_entry(
  p_room_id uuid,p_customer_id uuid,p_guest_name text,p_register_date date,
  p_discount numeric DEFAULT 0,p_paid boolean DEFAULT true,p_payment_method text DEFAULT 'cash'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid; v_tz text; v_existing public.stays%ROWTYPE; v_billing uuid; v_payment uuid; v_result jsonb; v_stay uuid;
BEGIN
  SELECT r.organization_id,COALESCE(NULLIF(o.hotel_timezone,''),'UTC') INTO v_org,v_tz
  FROM public.rooms r JOIN public.organizations o ON o.id=r.organization_id WHERE r.id=p_room_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Room was not found.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_org::text||':'||p_room_id::text,0));

  SELECT s.* INTO v_existing FROM public.stays s
  WHERE s.organization_id=v_org AND s.room_id=p_room_id
    AND (s.actual_check_in AT TIME ZONE v_tz)::date<=p_register_date
    AND (s.actual_check_out IS NULL OR (s.actual_check_out AT TIME ZONE v_tz)::date>p_register_date)
  ORDER BY s.actual_check_in DESC LIMIT 1 FOR UPDATE;

  IF FOUND AND (v_existing.reservation_id IS NOT NULL OR COALESCE(v_existing.billing_mode,'automatic')<>'cash_register') THEN
    RETURN jsonb_build_object('ok',true,'occupied_by_other_workflow',true,'stay_id',v_existing.id);
  END IF;
  IF FOUND THEN
    SELECT id INTO v_billing FROM public.billing WHERE stay_id=v_existing.id AND charge_type='room' AND stay_night_date=p_register_date ORDER BY charged_at,id LIMIT 1;
    IF v_billing IS NOT NULL THEN
      SELECT id INTO v_payment FROM public.payments WHERE billing_id=v_billing AND payment_status='completed' ORDER BY paid_at DESC LIMIT 1;
      RETURN jsonb_build_object('ok',true,'stay_id',v_existing.id,'billing_id',v_billing,'payment_id',v_payment,'already_saved',true);
    END IF;
    -- Close a legacy open-ended cash stay before beginning this independent day.
    UPDATE public.stays SET actual_check_out=((p_register_date::text||' 00:00:00')::timestamp AT TIME ZONE v_tz),checked_out_by=auth.uid() WHERE id=v_existing.id;
  END IF;

  v_result:=public.save_cash_room_register_customer_entry(p_room_id,p_customer_id,p_guest_name,p_register_date,p_discount,p_paid,p_payment_method);
  IF COALESCE((v_result->>'occupied_by_other_workflow')::boolean,false) THEN RETURN v_result; END IF;
  v_stay:=(v_result->>'stay_id')::uuid;
  UPDATE public.stays SET
    actual_check_out=(((p_register_date+1)::text||' 00:00:00')::timestamp AT TIME ZONE v_tz),
    checked_out_by=auth.uid()
  WHERE id=v_stay;
  UPDATE public.rooms r SET status='available' WHERE r.id=p_room_id
    AND NOT EXISTS(SELECT 1 FROM public.stays s WHERE s.room_id=p_room_id AND s.actual_check_out IS NULL);
  RETURN v_result||jsonb_build_object('daily_entry',true,'checkout_date',p_register_date+1);
END $$;
REVOKE ALL ON FUNCTION public.save_daily_cash_room_register_customer_entry(uuid,uuid,text,date,numeric,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_daily_cash_room_register_customer_entry(uuid,uuid,text,date,numeric,boolean,text) TO authenticated;
NOTIFY pgrst,'reload schema';
