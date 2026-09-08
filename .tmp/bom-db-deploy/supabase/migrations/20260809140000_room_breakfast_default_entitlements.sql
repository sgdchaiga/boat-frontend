ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS breakfast_included boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.ensure_room_breakfast_entitlement(p_stay_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s record; v_plan uuid; v_id uuid; v_adults int; v_children int; v_day date;
BEGIN
  SELECT st.*, rm.breakfast_included, COALESCE(o.hotel_timezone,'UTC') hotel_timezone,
         r.number_of_adults, r.number_of_children
    INTO s FROM stays st JOIN rooms rm ON rm.id=st.room_id
    JOIN organizations o ON o.id=st.organization_id
    LEFT JOIN reservations r ON r.id=st.reservation_id
   WHERE st.id=p_stay_id AND st.actual_check_out IS NULL;
  IF NOT FOUND OR NOT COALESCE(s.breakfast_included,true) THEN RETURN NULL; END IF;
  IF auth.role()<>'service_role' AND NOT EXISTS(SELECT 1 FROM staff x WHERE x.id=auth.uid() AND x.organization_id=s.organization_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  INSERT INTO hotel_rate_plans(organization_id,code,name,includes_breakfast,created_by)
  VALUES(s.organization_id,'ROOM-BB','Room Bed & Breakfast',true,CASE WHEN EXISTS(SELECT 1 FROM staff WHERE id=auth.uid()) THEN auth.uid() ELSE NULL END)
  ON CONFLICT(organization_id,code) DO UPDATE SET includes_breakfast=true,is_active=true
  RETURNING id INTO v_plan;
  UPDATE stays SET rate_plan_id=COALESCE(rate_plan_id,v_plan) WHERE id=s.id;
  v_day := (now() AT TIME ZONE s.hotel_timezone)::date;
  v_adults:=GREATEST(COALESCE(s.number_of_adults,1),0); v_children:=GREATEST(COALESCE(s.number_of_children,0),0);
  INSERT INTO hotel_breakfast_entitlements(organization_id,stay_id,rate_plan_id,service_date,eligible_adults,eligible_children,eligible_count,allocated_revenue)
  VALUES(s.organization_id,s.id,v_plan,v_day,v_adults,v_children,v_adults+v_children,0)
  ON CONFLICT(stay_id,service_date) DO UPDATE SET rate_plan_id=EXCLUDED.rate_plan_id
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION public.ensure_room_breakfast_entitlement(uuid) TO authenticated,service_role;

-- Repair reservations left pending when a stay was created before a later
-- check-in step failed.
UPDATE reservations r SET status='checked_in'
FROM stays s WHERE s.reservation_id=r.id AND s.actual_check_out IS NULL
  AND r.status IN ('pending','confirmed');
UPDATE rooms rm SET status='occupied'
WHERE EXISTS(SELECT 1 FROM stays s WHERE s.room_id=rm.id AND s.actual_check_out IS NULL);
