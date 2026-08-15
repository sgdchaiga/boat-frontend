CREATE OR REPLACE FUNCTION public.edit_cash_room_register_entry(
  p_stay_id uuid,p_customer_id uuid,p_register_date date,p_discount numeric,p_paid boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_actor uuid:=auth.uid(); v_stay public.stays%ROWTYPE; v_org uuid; v_rate numeric; v_net numeric;
  v_billing uuid; v_payment uuid; v_receivable uuid; v_revenue uuid; v_cash uuid; v_room_number text;
BEGIN
  SELECT s.* INTO v_stay FROM public.stays s WHERE s.id=p_stay_id FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_stay.billing_mode,'automatic')<>'cash_register' THEN RAISE EXCEPTION 'Cash Room Register entry was not found.'; END IF;
  v_org:=v_stay.organization_id;
  IF NOT public.is_platform_admin() AND NOT EXISTS(SELECT 1 FROM public.staff s WHERE s.id=v_actor AND s.organization_id=v_org AND COALESCE(s.is_active,true) AND s.role IN('super_admin','admin','manager','receptionist','housekeeping','accountant','supervisor')) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Not authorized to edit the cash room register.';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.hotel_customers c WHERE c.id=p_customer_id AND c.organization_id=v_org) THEN RAISE EXCEPTION 'Select a customer belonging to this hotel.'; END IF;
  SELECT COALESCE(r.nightly_rate,rt.base_price,0),r.room_number INTO v_rate,v_room_number FROM public.rooms r LEFT JOIN public.room_types rt ON rt.id=r.room_type_id WHERE r.id=v_stay.room_id;
  IF COALESCE(p_discount,0)<0 OR COALESCE(p_discount,0)>=v_rate THEN RAISE EXCEPTION 'Discount must be lower than the room rate.'; END IF;
  v_net:=v_rate-COALESCE(p_discount,0);
  SELECT b.id INTO v_billing FROM public.billing b WHERE b.stay_id=p_stay_id AND b.charge_type='room' AND b.stay_night_date=p_register_date ORDER BY b.charged_at,b.id LIMIT 1 FOR UPDATE;
  IF v_billing IS NULL THEN RAISE EXCEPTION 'The room charge for this date was not found.'; END IF;

  UPDATE public.stays SET property_customer_id=p_customer_id,room_discount_amount=COALESCE(p_discount,0),room_discount_reason=CASE WHEN COALESCE(p_discount,0)>0 THEN 'Cash room register' ELSE NULL END WHERE id=p_stay_id;
  UPDATE public.billing SET amount=v_net,description='Room '||v_room_number||' - cash register '||p_register_date WHERE id=v_billing;
  SELECT receivable_gl_account_id,revenue_gl_account_id,cash_gl_account_id INTO v_receivable,v_revenue,v_cash FROM public.journal_gl_settings WHERE organization_id=v_org;
  IF v_receivable IS NULL OR v_revenue IS NULL THEN RAISE EXCEPTION 'Configure hotel receivable and revenue accounts before editing this entry.'; END IF;
  UPDATE public.journal_entries SET is_deleted=true,deleted_at=now(),deleted_by=v_actor WHERE reference_type='room_charge' AND reference_id=v_billing AND COALESCE(is_deleted,false)=false;
  PERFORM public.create_journal_entry_atomic(p_register_date,'Cash register room charge (corrected)','room_charge',v_billing,v_actor,jsonb_build_array(
    jsonb_build_object('gl_account_id',v_receivable::text,'debit',v_net,'credit',0,'line_description','Room '||v_room_number),
    jsonb_build_object('gl_account_id',v_revenue::text,'debit',0,'credit',v_net,'line_description','Room revenue')),v_org);

  SELECT id INTO v_payment FROM public.payments WHERE billing_id=v_billing AND payment_status='completed' ORDER BY paid_at DESC LIMIT 1 FOR UPDATE;
  IF NOT COALESCE(p_paid,true) THEN
    IF v_payment IS NOT NULL THEN
      UPDATE public.journal_entries SET is_deleted=true,deleted_at=now(),deleted_by=v_actor WHERE reference_type='payment' AND reference_id=v_payment AND COALESCE(is_deleted,false)=false;
      UPDATE public.payments SET payment_status='refunded',amount=v_net,property_customer_id=p_customer_id WHERE id=v_payment;
      v_payment:=NULL;
    END IF;
  ELSE
    IF v_cash IS NULL OR v_receivable IS NULL THEN RAISE EXCEPTION 'Configure cash and receivable accounts before recording payment.'; END IF;
    IF v_payment IS NULL THEN
      INSERT INTO public.payments(organization_id,stay_id,property_customer_id,billing_id,amount,payment_method,payment_status,transaction_id,paid_at,processed_by,payment_source)
      VALUES(v_org,p_stay_id,p_customer_id,v_billing,v_net,'cash','completed','CASHROOM-'||left(p_stay_id::text,8)||'-'||to_char(p_register_date,'YYYYMMDD')||'-EDIT',p_register_date::timestamp+time '12:00',v_actor,'debtor') RETURNING id INTO v_payment;
    ELSE
      UPDATE public.payments SET amount=v_net,property_customer_id=p_customer_id WHERE id=v_payment;
      UPDATE public.journal_entries SET is_deleted=true,deleted_at=now(),deleted_by=v_actor WHERE reference_type='payment' AND reference_id=v_payment AND COALESCE(is_deleted,false)=false;
    END IF;
    PERFORM public.create_journal_entry_atomic(p_register_date,'Cash room payment (corrected)','payment',v_payment,v_actor,jsonb_build_array(
      jsonb_build_object('gl_account_id',v_cash::text,'debit',v_net,'credit',0,'line_description','Cash received'),
      jsonb_build_object('gl_account_id',v_receivable::text,'debit',0,'credit',v_net,'line_description','Room receivable settled')),v_org);
  END IF;
  RETURN jsonb_build_object('ok',true,'stay_id',p_stay_id,'billing_id',v_billing,'payment_id',v_payment,'amount',v_net);
END $$;
REVOKE ALL ON FUNCTION public.edit_cash_room_register_entry(uuid,uuid,date,numeric,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edit_cash_room_register_entry(uuid,uuid,date,numeric,boolean) TO authenticated;
NOTIFY pgrst,'reload schema';
