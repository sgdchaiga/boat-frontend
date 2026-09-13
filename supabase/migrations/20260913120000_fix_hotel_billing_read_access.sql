-- Restore SELECT access for active staff in their own hotel, including super_admin.
-- Do not change billing rows or existing write policies.
BEGIN;
DROP POLICY IF EXISTS billing_select_same_org ON public.billing;
CREATE POLICY billing_select_same_org
  ON public.billing FOR SELECT TO authenticated
  USING (
    organization_id = (
      SELECT st.organization_id FROM public.staff AS st
      WHERE st.id = auth.uid() AND COALESCE(st.is_active, true)
    )
  );

-- Qualify staff columns because RETURNS TABLE declares an output variable named id.
CREATE OR REPLACE FUNCTION public.get_hotel_billing_register(p_from date DEFAULT NULL,p_to date DEFAULT NULL)
RETURNS TABLE(id uuid,stay_id uuid,description text,charge_type text,amount numeric,charged_at timestamptz,created_by uuid,stay_night_date date,auto_charge_source text,room_number text,guest_first_name text,guest_last_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid;
BEGIN
  SELECT st.organization_id INTO v_org FROM public.staff AS st WHERE st.id=auth.uid() AND COALESCE(st.is_active,true);
  IF v_org IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='No active hotel organization is linked to this user.'; END IF;
  RETURN QUERY SELECT
    b.id::uuid,b.stay_id::uuid,b.description::text,b.charge_type::text,b.amount::numeric,
    b.charged_at::timestamptz,b.created_by::uuid,b.stay_night_date::date,b.auto_charge_source::text,
    rm.room_number::text,c.first_name::text,c.last_name::text
  FROM public.billing b
  JOIN public.stays s ON s.id=b.stay_id
  LEFT JOIN public.rooms rm ON rm.id=s.room_id
  LEFT JOIN public.hotel_customers c ON c.id=s.property_customer_id
  WHERE s.organization_id=v_org
    AND (p_from IS NULL OR b.charged_at::date>=p_from)
    AND (p_to IS NULL OR b.charged_at::date<=p_to)
  ORDER BY b.charged_at DESC,b.id DESC;
END $$;
REVOKE ALL ON FUNCTION public.get_hotel_billing_register(date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_hotel_billing_register(date,date) TO authenticated;

COMMIT;
