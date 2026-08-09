-- Lock only the billing row. PostgreSQL rejects an unqualified FOR UPDATE
-- when the query contains the nullable side of a LEFT JOIN.
CREATE OR REPLACE FUNCTION public.generate_hotel_breakfast_entitlement(p_billing_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b record; rp record; v_adults int; v_children int; v_id uuid;
BEGIN
  SELECT bi.*, s.reservation_id, COALESCE(s.rate_plan_id, bi.rate_plan_id, r.rate_plan_id) effective_plan
    INTO b FROM billing bi JOIN stays s ON s.id=bi.stay_id
    LEFT JOIN reservations r ON r.id=s.reservation_id WHERE bi.id=p_billing_id FOR UPDATE OF bi;
  IF NOT FOUND OR b.charge_type <> 'room' OR b.stay_night_date IS NULL OR b.effective_plan IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO rp FROM hotel_rate_plans WHERE id=b.effective_plan AND organization_id=b.organization_id AND includes_breakfast AND is_active;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT CASE WHEN rp.adults_eligible THEN COALESCE(r.number_of_adults, r.number_of_guests, 1) ELSE 0 END,
         CASE WHEN rp.children_eligible THEN COALESCE(r.number_of_children,0) ELSE 0 END
    INTO v_adults,v_children FROM stays s LEFT JOIN reservations r ON r.id=s.reservation_id WHERE s.id=b.stay_id;
  v_adults:=COALESCE(v_adults,1); v_children:=COALESCE(v_children,0);
  INSERT INTO hotel_breakfast_entitlements(organization_id,stay_id,billing_id,rate_plan_id,service_date,
    eligible_adults,eligible_children,eligible_count,allocated_revenue)
  VALUES(b.organization_id,b.stay_id,b.id,rp.id,b.stay_night_date+1,v_adults,v_children,v_adults+v_children,
    LEAST(b.amount,v_adults*rp.breakfast_allocation_adult+v_children*rp.breakfast_allocation_child))
  ON CONFLICT(stay_id,service_date) DO UPDATE SET billing_id=EXCLUDED.billing_id
  RETURNING id INTO v_id;
  UPDATE billing SET rate_plan_id=rp.id,
    breakfast_revenue_amount=LEAST(amount,v_adults*rp.breakfast_allocation_adult+v_children*rp.breakfast_allocation_child),
    accommodation_revenue_amount=GREATEST(0,amount-(v_adults*rp.breakfast_allocation_adult+v_children*rp.breakfast_allocation_child))
  WHERE id=b.id;
  RETURN v_id;
END $$;
