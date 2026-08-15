-- Cash-register stays are billed by save_cash_room_register_customer_entry.
-- Do not let the generic first-night trigger post a competing automatic charge.
CREATE OR REPLACE FUNCTION public.post_first_room_night_on_stay_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result jsonb;
BEGIN
  IF COALESCE(NEW.billing_mode,'automatic')='cash_register' THEN RETURN NEW; END IF;
  v_result:=post_hotel_room_night_charge(NEW.organization_id,NEW.id,'checkin',NEW.checked_in_by,NULL);
  IF COALESCE((v_result->>'ok')::boolean,false)=false THEN
    RAISE EXCEPTION 'First-night room charge failed: %',COALESCE(v_result->>'error','unknown error');
  END IF;
  RETURN NEW;
END $$;

-- Save the selected customer directly. The previous wrapper created a temporary
-- customer first and tried to replace it afterwards, which made Save day depend
-- on an unnecessary second customer write.
CREATE OR REPLACE FUNCTION public.save_cash_room_register_customer_entry(
  p_room_id uuid,
  p_customer_id uuid,
  p_guest_name text,
  p_register_date date,
  p_discount numeric DEFAULT 0,
  p_paid boolean DEFAULT true,
  p_payment_method text DEFAULT 'cash'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_actor uuid:=auth.uid(); v_org uuid; v_stay public.stays%ROWTYPE;
  v_rate numeric; v_net numeric; v_billing uuid; v_payment uuid;
  v_receivable uuid; v_revenue uuid; v_asset uuid; v_room_number text; v_tz text;
BEGIN
  IF p_register_date IS NULL THEN RAISE EXCEPTION 'Register date is required.'; END IF;
  IF p_payment_method NOT IN ('cash','card','bank_transfer','mtn_mobile_money','airtel_money') THEN RAISE EXCEPTION 'Unsupported payment method.'; END IF;

  SELECT r.organization_id,r.room_number,COALESCE(r.nightly_rate,rt.base_price,0)
    INTO v_org,v_room_number,v_rate
  FROM public.rooms r LEFT JOIN public.room_types rt ON rt.id=r.room_type_id
  WHERE r.id=p_room_id FOR UPDATE OF r;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Room was not found.'; END IF;
  IF p_customer_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.hotel_customers c WHERE c.id=p_customer_id AND c.organization_id=v_org
  ) THEN RAISE EXCEPTION 'Select a customer belonging to this hotel.'; END IF;
  IF NOT public.is_platform_admin() AND NOT EXISTS(
    SELECT 1 FROM public.staff s WHERE s.id=v_actor AND s.organization_id=v_org AND COALESCE(s.is_active,true)
      AND s.role IN ('super_admin','admin','manager','receptionist','housekeeping','accountant','supervisor')
  ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Not authorized to use the cash room register.'; END IF;
  IF COALESCE(v_rate,0)<=0 THEN RAISE EXCEPTION 'Configure a nightly rate for this room.'; END IF;
  IF COALESCE(p_discount,0)<0 OR COALESCE(p_discount,0)>=v_rate THEN RAISE EXCEPTION 'Discount must be lower than the room rate.'; END IF;
  v_net:=v_rate-COALESCE(p_discount,0);
  v_tz:=COALESCE(NULLIF((SELECT hotel_timezone FROM public.organizations WHERE id=v_org),''),'UTC');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_org::text||':'||p_room_id::text,0));

  SELECT * INTO v_stay FROM public.stays s
   WHERE s.organization_id=v_org AND s.room_id=p_room_id AND s.actual_check_out IS NULL
   ORDER BY s.actual_check_in DESC LIMIT 1 FOR UPDATE;
  IF FOUND AND (v_stay.reservation_id IS NOT NULL OR COALESCE(v_stay.billing_mode,'automatic')<>'cash_register') THEN
    RETURN jsonb_build_object('ok',true,'occupied_by_other_workflow',true,'stay_id',v_stay.id);
  END IF;

  IF NOT FOUND THEN
    INSERT INTO public.stays(organization_id,room_id,property_customer_id,actual_check_in,checked_in_by,
      room_discount_amount,room_discount_reason,billing_mode)
    VALUES(v_org,p_room_id,p_customer_id,((p_register_date::text||' 12:00:00')::timestamp AT TIME ZONE v_tz),v_actor,
      COALESCE(p_discount,0),CASE WHEN COALESCE(p_discount,0)>0 THEN 'Cash room register' ELSE NULL END,'cash_register')
    RETURNING * INTO v_stay;
    UPDATE public.rooms SET status='occupied' WHERE id=p_room_id;
  ELSE
    IF p_register_date < (v_stay.actual_check_in AT TIME ZONE v_tz)::date THEN RAISE EXCEPTION 'Register date cannot be before check-in.'; END IF;
    UPDATE public.stays SET property_customer_id=p_customer_id,room_discount_amount=COALESCE(p_discount,0),
      room_discount_reason=CASE WHEN COALESCE(p_discount,0)>0 THEN 'Cash room register' ELSE NULL END
    WHERE id=v_stay.id RETURNING * INTO v_stay;
  END IF;

  SELECT b.id INTO v_billing FROM public.billing b
   WHERE b.stay_id=v_stay.id AND b.charge_type='room' AND b.stay_night_date=p_register_date
   ORDER BY b.charged_at,b.id LIMIT 1 FOR UPDATE;
  IF v_billing IS NULL THEN
    SELECT receivable_gl_account_id,revenue_gl_account_id INTO v_receivable,v_revenue
      FROM public.journal_gl_settings WHERE organization_id=v_org;
    IF v_receivable IS NULL OR v_revenue IS NULL THEN RAISE EXCEPTION 'Configure hotel receivable and revenue accounts before using the cash room register.'; END IF;
    INSERT INTO public.billing(organization_id,stay_id,description,charge_type,amount,charged_at,created_by,stay_night_date,auto_charge_source)
    VALUES(v_org,v_stay.id,'Room '||v_room_number||' - cash register '||p_register_date,'room',v_net,
      ((p_register_date::text||' 12:00:00')::timestamp AT TIME ZONE v_tz),v_actor,p_register_date,'manual') RETURNING id INTO v_billing;
    PERFORM public.create_journal_entry_atomic(p_register_date,'Cash register room charge','room_charge',v_billing,v_actor,
      jsonb_build_array(
        jsonb_build_object('gl_account_id',v_receivable::text,'debit',v_net,'credit',0,'line_description','Room '||v_room_number),
        jsonb_build_object('gl_account_id',v_revenue::text,'debit',0,'credit',v_net,'line_description','Room revenue')
      ),v_org);
  END IF;

  IF COALESCE(p_paid,true) THEN
    SELECT id INTO v_payment FROM public.payments WHERE billing_id=v_billing AND payment_status='completed' LIMIT 1;
    IF v_payment IS NULL THEN
      SELECT CASE p_payment_method WHEN 'cash' THEN j.cash_gl_account_id
        WHEN 'mtn_mobile_money' THEN COALESCE(j.pos_mtn_mobile_money_gl_account_id,j.cash_gl_account_id)
        WHEN 'airtel_money' THEN COALESCE(j.pos_airtel_money_gl_account_id,j.cash_gl_account_id)
        ELSE COALESCE(j.pos_bank_gl_account_id,j.cash_gl_account_id) END,j.receivable_gl_account_id
        INTO v_asset,v_receivable FROM public.journal_gl_settings j WHERE j.organization_id=v_org;
      IF v_asset IS NULL OR v_receivable IS NULL THEN RAISE EXCEPTION 'Configure cash and receivable accounts before recording payment.'; END IF;
      INSERT INTO public.payments(organization_id,stay_id,property_customer_id,billing_id,amount,payment_method,payment_status,transaction_id,paid_at,processed_by,payment_source)
      VALUES(v_org,v_stay.id,p_customer_id,v_billing,v_net,p_payment_method,'completed',
        'CASHROOM-'||left(v_stay.id::text,8)||'-'||to_char(p_register_date,'YYYYMMDD'),
        ((p_register_date::text||' 12:00:00')::timestamp AT TIME ZONE v_tz),v_actor,'debtor') RETURNING id INTO v_payment;
      PERFORM public.create_journal_entry_atomic(p_register_date,'Cash room payment','payment',v_payment,v_actor,
        jsonb_build_array(
          jsonb_build_object('gl_account_id',v_asset::text,'debit',v_net,'credit',0,'line_description','Cash received'),
          jsonb_build_object('gl_account_id',v_receivable::text,'debit',0,'credit',v_net,'line_description','Room receivable settled')
        ),v_org);
    END IF;
  END IF;
  RETURN jsonb_build_object('ok',true,'stay_id',v_stay.id,'billing_id',v_billing,'payment_id',v_payment,'amount',v_net,'property_customer_id',p_customer_id);
END $$;

REVOKE ALL ON FUNCTION public.save_cash_room_register_customer_entry(uuid,uuid,text,date,numeric,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_cash_room_register_customer_entry(uuid,uuid,text,date,numeric,boolean,text) TO authenticated;

NOTIFY pgrst, 'reload schema';
