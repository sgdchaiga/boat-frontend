CREATE TABLE IF NOT EXISTS public.cash_room_register_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
  stay_id uuid NOT NULL, register_date date NOT NULL, correction_type text NOT NULL,
  snapshot jsonb NOT NULL, corrected_by uuid, corrected_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cash_room_register_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cash_room_register_corrections FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.unmark_cash_room_register_occupied(p_stay_id uuid,p_register_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_actor uuid:=auth.uid(); v_stay public.stays%ROWTYPE; v_billing uuid; v_payment uuid; v_other_days int; v_room uuid;
BEGIN
  SELECT * INTO v_stay FROM public.stays WHERE id=p_stay_id FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_stay.billing_mode,'automatic')<>'cash_register' THEN RAISE EXCEPTION 'Cash Room Register entry was not found.'; END IF;
  IF NOT public.is_platform_admin() AND NOT EXISTS(SELECT 1 FROM public.staff s WHERE s.id=v_actor AND s.organization_id=v_stay.organization_id AND COALESCE(s.is_active,true) AND s.role IN('super_admin','admin','manager','receptionist','housekeeping','accountant','supervisor')) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Not authorized to correct the cash room register.';
  END IF;
  SELECT id INTO v_billing FROM public.billing WHERE stay_id=p_stay_id AND charge_type='room' AND stay_night_date=p_register_date ORDER BY charged_at,id LIMIT 1 FOR UPDATE;
  IF v_billing IS NULL THEN RAISE EXCEPTION 'The room entry for this date was not found.'; END IF;
  SELECT count(*) INTO v_other_days FROM public.billing WHERE stay_id=p_stay_id AND charge_type='room' AND id<>v_billing;
  IF v_other_days>0 THEN RAISE EXCEPTION 'This stay has other saved room days. Remove or correct those days first before marking this day vacant.'; END IF;
  SELECT id INTO v_payment FROM public.payments WHERE billing_id=v_billing AND payment_status='completed' ORDER BY paid_at DESC LIMIT 1 FOR UPDATE;
  v_room:=v_stay.room_id;

  INSERT INTO public.cash_room_register_corrections(organization_id,stay_id,register_date,correction_type,snapshot,corrected_by)
  VALUES(v_stay.organization_id,p_stay_id,p_register_date,'unmark_occupied',jsonb_build_object(
    'stay',to_jsonb(v_stay),
    'billing',(SELECT to_jsonb(b) FROM public.billing b WHERE b.id=v_billing),
    'payment',(SELECT to_jsonb(p) FROM public.payments p WHERE p.id=v_payment),
    'journals',(SELECT COALESCE(jsonb_agg(to_jsonb(je)),'[]'::jsonb) FROM public.journal_entries je WHERE COALESCE(je.is_deleted,false)=false AND ((je.reference_type='room_charge' AND je.reference_id=v_billing) OR (je.reference_type='payment' AND je.reference_id=v_payment)))
  ),v_actor);

  UPDATE public.journal_entries SET is_deleted=true,deleted_at=now(),deleted_by=v_actor
  WHERE COALESCE(is_deleted,false)=false AND ((reference_type='room_charge' AND reference_id=v_billing) OR (reference_type='payment' AND reference_id=v_payment));
  IF v_payment IS NOT NULL THEN UPDATE public.payments SET payment_status='refunded' WHERE id=v_payment; END IF;
  DELETE FROM public.billing WHERE id=v_billing;
  DELETE FROM public.stays WHERE id=p_stay_id;
  UPDATE public.rooms SET status='available' WHERE id=v_room AND NOT EXISTS(SELECT 1 FROM public.stays WHERE room_id=v_room AND actual_check_out IS NULL);
  RETURN jsonb_build_object('ok',true,'room_id',v_room,'register_date',p_register_date,'reversed_payment_id',v_payment);
END $$;
REVOKE ALL ON FUNCTION public.unmark_cash_room_register_occupied(uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unmark_cash_room_register_occupied(uuid,date) TO authenticated;
NOTIFY pgrst,'reload schema';
