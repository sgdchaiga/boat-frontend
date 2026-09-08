-- Daily cash-room register. Cash-register stays are manually charged from the
-- register and are excluded from automatic night audit.
ALTER TABLE public.stays
  ADD COLUMN IF NOT EXISTS billing_mode text NOT NULL DEFAULT 'automatic'
  CHECK (billing_mode IN ('automatic','cash_register'));

CREATE OR REPLACE FUNCTION public.save_cash_room_register_entry(
  p_room_id uuid,
  p_guest_name text,
  p_register_date date,
  p_discount numeric DEFAULT 0,
  p_paid boolean DEFAULT true,
  p_payment_method text DEFAULT 'cash'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_actor uuid:=auth.uid(); v_org uuid; v_stay public.stays%ROWTYPE; v_guest uuid;
  v_first text; v_last text; v_rate numeric; v_net numeric; v_billing uuid; v_payment uuid;
  v_receivable uuid; v_revenue uuid; v_asset uuid; v_room_number text; v_tz text;
BEGIN
  IF p_register_date IS NULL THEN RAISE EXCEPTION 'Register date is required.'; END IF;
  IF NULLIF(trim(COALESCE(p_guest_name,'')),'') IS NULL THEN RAISE EXCEPTION 'Guest name is required.'; END IF;
  IF p_payment_method NOT IN ('cash','card','bank_transfer','mtn_mobile_money','airtel_money') THEN RAISE EXCEPTION 'Unsupported payment method.'; END IF;

  SELECT r.organization_id,r.room_number,COALESCE(r.nightly_rate,rt.base_price,0)
    INTO v_org,v_room_number,v_rate
  FROM public.rooms r LEFT JOIN public.room_types rt ON rt.id=r.room_type_id
  WHERE r.id=p_room_id FOR UPDATE OF r;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Room was not found.'; END IF;
  IF NOT public.is_platform_admin() AND NOT EXISTS(
    SELECT 1 FROM public.staff s WHERE s.id=v_actor AND s.organization_id=v_org AND COALESCE(s.is_active,true)
      AND s.role IN ('super_admin','admin','manager','receptionist','housekeeping','accountant','supervisor')
  ) AND NOT EXISTS(
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id=v_actor AND om.organization_id=v_org AND om.is_active=true
      AND om.role IN ('super_admin','admin','manager','receptionist','housekeeping','accountant','supervisor')
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
    v_first:=split_part(trim(p_guest_name),' ',1);
    v_last:=NULLIF(trim(substr(trim(p_guest_name),length(v_first)+1)),'');
    INSERT INTO public.hotel_customers(organization_id,first_name,last_name)
      VALUES(v_org,v_first,COALESCE(v_last,'Guest')) RETURNING id INTO v_guest;
    INSERT INTO public.stays(organization_id,room_id,property_customer_id,actual_check_in,checked_in_by,
      room_discount_amount,room_discount_reason,billing_mode)
    VALUES(v_org,p_room_id,v_guest,((p_register_date::text||' 12:00:00')::timestamp AT TIME ZONE v_tz),v_actor,
      COALESCE(p_discount,0),CASE WHEN COALESCE(p_discount,0)>0 THEN 'Cash room register' ELSE NULL END,'cash_register')
    RETURNING * INTO v_stay;
    UPDATE public.rooms SET status='occupied' WHERE id=p_room_id;
  ELSE
    IF p_register_date < (v_stay.actual_check_in AT TIME ZONE v_tz)::date THEN RAISE EXCEPTION 'Register date cannot be before check-in.'; END IF;
    UPDATE public.stays SET room_discount_amount=COALESCE(p_discount,0),
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
      VALUES(v_org,v_stay.id,v_stay.property_customer_id,v_billing,v_net,p_payment_method,'completed',
        'CASHROOM-'||left(v_stay.id::text,8)||'-'||to_char(p_register_date,'YYYYMMDD'),
        ((p_register_date::text||' 12:00:00')::timestamp AT TIME ZONE v_tz),v_actor,'debtor') RETURNING id INTO v_payment;
      PERFORM public.create_journal_entry_atomic(p_register_date,'Cash room payment','payment',v_payment,v_actor,
        jsonb_build_array(
          jsonb_build_object('gl_account_id',v_asset::text,'debit',v_net,'credit',0,'line_description','Cash received'),
          jsonb_build_object('gl_account_id',v_receivable::text,'debit',0,'credit',v_net,'line_description','Room receivable settled')
        ),v_org);
    END IF;
  END IF;
  RETURN jsonb_build_object('ok',true,'stay_id',v_stay.id,'billing_id',v_billing,'payment_id',v_payment,'amount',v_net);
END $$;
REVOKE ALL ON FUNCTION public.save_cash_room_register_entry(uuid,text,date,numeric,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_cash_room_register_entry(uuid,text,date,numeric,boolean,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.run_hotel_night_audit_for_org(
  p_organization_id uuid,p_folio_night_date date DEFAULT NULL,p_created_by uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_allowed boolean:=false; v_enabled boolean:=true; v_tz text; v_night date; st record; v_res jsonb;
  v_posted int:=0; v_skipped int:=0; v_failed int:=0; v_last_err text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=p_organization_id) THEN RETURN jsonb_build_object('ok',false,'error','organization_not_found'); END IF;
  SELECT COALESCE(hotel_enable_smart_room_charges,true),COALESCE(NULLIF(hotel_timezone,''),'UTC') INTO v_enabled,v_tz FROM public.organizations WHERE id=p_organization_id;
  IF NOT v_enabled THEN RETURN jsonb_build_object('ok',true,'posted',0,'skipped',0,'failed',0,'reason','smart_room_charges_disabled'); END IF;
  v_allowed:=auth.role()='service_role' OR EXISTS(SELECT 1 FROM public.staff WHERE id=auth.uid() AND organization_id=p_organization_id);
  IF NOT v_allowed THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
  v_night:=COALESCE(p_folio_night_date,(CURRENT_TIMESTAMP AT TIME ZONE v_tz)::date-1);
  FOR st IN SELECT s.id FROM public.stays s LEFT JOIN public.reservations r ON r.id=s.reservation_id
    WHERE s.organization_id=p_organization_id AND COALESCE(s.billing_mode,'automatic')<>'cash_register'
      AND (s.actual_check_in AT TIME ZONE v_tz)::date<=v_night
      AND (s.actual_check_out IS NULL OR (s.actual_check_out AT TIME ZONE v_tz)::date>v_night)
      AND (s.reservation_id IS NULL OR r.check_out_date IS NULL OR r.check_out_date>v_night)
  LOOP
    v_res:=public.post_hotel_room_night_charge(p_organization_id,st.id,'night_audit',p_created_by,v_night);
    IF COALESCE((v_res->>'ok')::boolean,false) THEN IF COALESCE((v_res->>'skipped')::boolean,false) THEN v_skipped:=v_skipped+1; ELSE v_posted:=v_posted+1; END IF;
    ELSE v_failed:=v_failed+1; v_last_err:=COALESCE(v_res->>'error',v_res::text); END IF;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'folio_night_date',v_night,'posted',v_posted,'skipped',v_skipped,'failed',v_failed,'last_error',v_last_err);
END $$;
