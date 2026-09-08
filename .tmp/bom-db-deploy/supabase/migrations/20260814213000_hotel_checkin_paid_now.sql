-- Optional, atomic first-night settlement during check-in. Daily midday room
-- charges intentionally do not call this function and remain unpaid.

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS billing_id uuid REFERENCES public.billing(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payments_completed_billing_uq ON public.payments(billing_id)
WHERE billing_id IS NOT NULL AND payment_status='completed';

CREATE OR REPLACE FUNCTION public.record_hotel_checkin_payment(
  p_stay_id uuid,p_payment_method text,p_reference text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_stay public.stays%ROWTYPE; v_billing public.billing%ROWTYPE; v_payment uuid; v_asset uuid; v_receivable uuid; v_night date; v_tz text;
BEGIN
  IF p_payment_method NOT IN ('cash','card','bank_transfer','mtn_mobile_money','airtel_money') THEN RAISE EXCEPTION 'Unsupported payment method.'; END IF;
  SELECT * INTO v_stay FROM public.stays WHERE id=p_stay_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stay not found.'; END IF;
  IF NOT public.is_platform_admin() AND NOT EXISTS(SELECT 1 FROM public.staff s WHERE s.id=auth.uid() AND s.organization_id=v_stay.organization_id AND COALESCE(s.is_active,true)) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Not authorized to settle this stay.';
  END IF;
  v_tz:=COALESCE(NULLIF((SELECT hotel_timezone FROM public.organizations WHERE id=v_stay.organization_id),''),'UTC');
  v_night:=(v_stay.actual_check_in AT TIME ZONE v_tz)::date;
  SELECT * INTO v_billing FROM public.billing b WHERE b.stay_id=v_stay.id AND b.charge_type='room' AND b.stay_night_date=v_night ORDER BY b.charged_at,b.id LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The first-night room bill was not created.'; END IF;
  SELECT p.id INTO v_payment FROM public.payments p WHERE p.billing_id=v_billing.id AND p.payment_status='completed' LIMIT 1;
  IF v_payment IS NOT NULL THEN RETURN v_payment; END IF;

  SELECT CASE p_payment_method
      WHEN 'cash' THEN j.cash_gl_account_id
      WHEN 'mtn_mobile_money' THEN COALESCE(j.pos_mtn_mobile_money_gl_account_id,j.cash_gl_account_id)
      WHEN 'airtel_money' THEN COALESCE(j.pos_airtel_money_gl_account_id,j.cash_gl_account_id)
      ELSE COALESCE(j.pos_bank_gl_account_id,j.cash_gl_account_id)
    END,j.receivable_gl_account_id INTO v_asset,v_receivable
  FROM public.journal_gl_settings j WHERE j.organization_id=v_stay.organization_id;
  IF v_asset IS NULL OR v_receivable IS NULL THEN RAISE EXCEPTION 'Configure the receipt and receivable GL accounts before recording check-in payment.'; END IF;

  INSERT INTO public.payments(organization_id,stay_id,property_customer_id,billing_id,amount,payment_method,payment_status,transaction_id,paid_at,processed_by,payment_source)
  VALUES(v_stay.organization_id,v_stay.id,v_stay.property_customer_id,v_billing.id,v_billing.amount,p_payment_method,'completed',
    COALESCE(NULLIF(trim(p_reference),''),'CHECKIN-'||left(v_stay.id::text,8)||'-'||to_char(v_night,'YYYYMMDD')),now(),v_stay.checked_in_by,'debtor')
  RETURNING id INTO v_payment;

  PERFORM public.create_journal_entry_atomic(v_night,'Check-in room payment','payment',v_payment,v_stay.checked_in_by,
    jsonb_build_array(
      jsonb_build_object('gl_account_id',v_asset::text,'debit',v_billing.amount,'credit',0,'line_description',initcap(replace(p_payment_method,'_',' '))||' received'),
      jsonb_build_object('gl_account_id',v_receivable::text,'debit',0,'credit',v_billing.amount,'line_description','Room receivable settled')
    ),v_stay.organization_id);
  RETURN v_payment;
END $$;
REVOKE ALL ON FUNCTION public.record_hotel_checkin_payment(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_hotel_checkin_payment(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.hotel_check_in_reservation_with_payment(
  p_reservation_id uuid,p_actual_check_in timestamptz DEFAULT now(),p_paid_now boolean DEFAULT true,
  p_payment_method text DEFAULT 'cash',p_payment_reference text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result jsonb; v_stay uuid; v_payment uuid;
BEGIN
  v_result:=public.hotel_check_in_reservation(p_reservation_id,p_actual_check_in);
  v_stay:=(v_result->>'stay_id')::uuid;
  IF COALESCE(p_paid_now,true) THEN v_payment:=public.record_hotel_checkin_payment(v_stay,p_payment_method,p_payment_reference); END IF;
  RETURN v_result||jsonb_build_object('paid_now',COALESCE(p_paid_now,true),'payment_id',v_payment);
END $$;
REVOKE ALL ON FUNCTION public.hotel_check_in_reservation_with_payment(uuid,timestamptz,boolean,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hotel_check_in_reservation_with_payment(uuid,timestamptz,boolean,text,text) TO authenticated;
