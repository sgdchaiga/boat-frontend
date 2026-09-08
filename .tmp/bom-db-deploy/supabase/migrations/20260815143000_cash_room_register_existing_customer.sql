-- Link Cash Room Register entries to an existing hotel customer selected by
-- the user. The original posting function remains the single accounting path;
-- this wrapper replaces its temporary guest link atomically.
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
DECLARE v_org uuid; v_old_customer uuid; v_result jsonb; v_stay uuid; v_payment uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.rooms WHERE id=p_room_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Room was not found.'; END IF;
  IF p_customer_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.hotel_customers c WHERE c.id=p_customer_id AND c.organization_id=v_org
  ) THEN RAISE EXCEPTION 'Select a customer belonging to this hotel.'; END IF;

  v_result:=public.save_cash_room_register_entry(p_room_id,p_guest_name,p_register_date,p_discount,p_paid,p_payment_method);
  IF COALESCE((v_result->>'occupied_by_other_workflow')::boolean,false) THEN RETURN v_result; END IF;
  v_stay:=(v_result->>'stay_id')::uuid; v_payment:=NULLIF(v_result->>'payment_id','')::uuid;
  SELECT property_customer_id INTO v_old_customer FROM public.stays WHERE id=v_stay FOR UPDATE;
  UPDATE public.stays SET property_customer_id=p_customer_id WHERE id=v_stay;
  IF v_payment IS NOT NULL THEN UPDATE public.payments SET property_customer_id=p_customer_id WHERE id=v_payment; END IF;
  IF v_old_customer IS DISTINCT FROM p_customer_id
    AND NOT EXISTS(SELECT 1 FROM public.stays WHERE property_customer_id=v_old_customer)
    AND NOT EXISTS(SELECT 1 FROM public.reservations WHERE property_customer_id=v_old_customer)
    AND NOT EXISTS(SELECT 1 FROM public.payments WHERE property_customer_id=v_old_customer)
  THEN DELETE FROM public.hotel_customers WHERE id=v_old_customer AND organization_id=v_org; END IF;
  RETURN v_result||jsonb_build_object('property_customer_id',p_customer_id);
END $$;
REVOKE ALL ON FUNCTION public.save_cash_room_register_customer_entry(uuid,uuid,text,date,numeric,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_cash_room_register_customer_entry(uuid,uuid,text,date,numeric,boolean,text) TO authenticated;
