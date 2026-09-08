-- Every breakfast-enabled occupied room has at least one included serving.
UPDATE public.hotel_breakfast_entitlements
SET eligible_adults = GREATEST(eligible_adults, 1),
    eligible_count = GREATEST(eligible_count, 1)
WHERE eligible_count < 1;

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
  IF auth.role()<>'service_role' AND NOT EXISTS(SELECT 1 FROM staff x WHERE x.id=auth.uid() AND x.organization_id=s.organization_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  INSERT INTO hotel_rate_plans(organization_id,code,name,includes_breakfast,created_by)
  VALUES(s.organization_id,'ROOM-BB','Room Bed & Breakfast',true,CASE WHEN EXISTS(SELECT 1 FROM staff WHERE id=auth.uid()) THEN auth.uid() ELSE NULL END)
  ON CONFLICT(organization_id,code) DO UPDATE SET includes_breakfast=true,is_active=true RETURNING id INTO v_plan;
  UPDATE stays SET rate_plan_id=COALESCE(rate_plan_id,v_plan) WHERE id=s.id;
  v_day := (now() AT TIME ZONE s.hotel_timezone)::date;
  v_adults:=GREATEST(COALESCE(NULLIF(s.number_of_adults,0),1),1);
  v_children:=GREATEST(COALESCE(s.number_of_children,0),0);
  INSERT INTO hotel_breakfast_entitlements(organization_id,stay_id,rate_plan_id,service_date,eligible_adults,eligible_children,eligible_count,allocated_revenue)
  VALUES(s.organization_id,s.id,v_plan,v_day,v_adults,v_children,v_adults+v_children,0)
  ON CONFLICT(stay_id,service_date) DO UPDATE SET rate_plan_id=EXCLUDED.rate_plan_id,
    eligible_adults=GREATEST(hotel_breakfast_entitlements.eligible_adults,EXCLUDED.eligible_adults),
    eligible_children=GREATEST(hotel_breakfast_entitlements.eligible_children,EXCLUDED.eligible_children),
    eligible_count=GREATEST(hotel_breakfast_entitlements.eligible_count,EXCLUDED.eligible_count)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- A closing-time status is a reporting marker, not an extra serving. Manager
-- approval is required only when the requested quantity exceeds entitlement.
CREATE OR REPLACE FUNCTION public.serve_included_breakfast(
  p_entitlement_id uuid, p_kitchen_order_id uuid, p_servings integer,
  p_manager_pin text DEFAULT NULL, p_override_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE e record; st record; v_org uuid; v_approver uuid; v_extra boolean:=false; v_cost numeric(12,2):=0; x record; v_jid uuid; v_cogs uuid; v_inv uuid;
BEGIN
  SELECT organization_id INTO v_org FROM staff WHERE id=auth.uid() AND is_active;
  SELECT be.*,o.breakfast_closing_time INTO e FROM hotel_breakfast_entitlements be JOIN organizations o ON o.id=be.organization_id WHERE be.id=p_entitlement_id FOR UPDATE OF be;
  IF NOT FOUND OR e.organization_id IS DISTINCT FROM v_org THEN RAISE EXCEPTION 'Breakfast entitlement not found'; END IF;
  SELECT s.*,r.check_out_date INTO st FROM stays s LEFT JOIN reservations r ON r.id=s.reservation_id WHERE s.id=e.stay_id;
  IF st.actual_check_out IS NOT NULL OR st.room_id IS DISTINCT FROM (SELECT room_id FROM kitchen_orders WHERE id=p_kitchen_order_id) THEN RAISE EXCEPTION 'Room does not have the matching active stay'; END IF;
  IF e.service_date IS DISTINCT FROM ((now() AT TIME ZONE COALESCE((SELECT hotel_timezone FROM organizations WHERE id=v_org),'UTC'))::date) THEN RAISE EXCEPTION 'Entitlement is not valid for today'; END IF;
  IF p_servings IS NULL OR p_servings<1 THEN RAISE EXCEPTION 'Servings must be positive'; END IF;
  v_extra := e.served_count+p_servings>GREATEST(e.eligible_count,1) OR e.status IN ('served','complimentary_extra');
  IF v_extra THEN
    IF COALESCE(trim(p_override_reason),'')='' OR p_manager_pin IS NULL THEN RAISE EXCEPTION 'Manager approval and audit reason required only for servings above the room package allowance'; END IF;
    SELECT p.staff_id INTO v_approver FROM pos_manager_pin_hashes p JOIN staff s ON s.id=p.staff_id WHERE p.organization_id=v_org AND s.role IN ('admin','manager','super_admin') AND crypt(p_manager_pin,p.pin_hash)=p.pin_hash LIMIT 1;
    IF v_approver IS NULL THEN RAISE EXCEPTION 'Manager approval failed'; END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM hotel_breakfast_claims WHERE kitchen_order_id=p_kitchen_order_id) THEN RAISE EXCEPTION 'Kitchen order already claimed'; END IF;
  IF EXISTS(SELECT 1 FROM kitchen_order_items koi WHERE koi.order_id=p_kitchen_order_id AND NOT EXISTS(SELECT 1 FROM product_recipe_items pri WHERE pri.product_id=koi.product_id)) THEN RAISE EXCEPTION 'Every included breakfast item must have a configured recipe'; END IF;
  FOR x IN SELECT pri.ingredient_product_id product_id,SUM(pri.quantity_per_unit*koi.quantity) qty,MAX(COALESCE(p.cost_price,0)) unit_cost FROM kitchen_order_items koi JOIN product_recipe_items pri ON pri.product_id=koi.product_id JOIN products p ON p.id=pri.ingredient_product_id WHERE koi.order_id=p_kitchen_order_id GROUP BY pri.ingredient_product_id LOOP
    INSERT INTO product_stock_movements(product_id,source_type,source_id,quantity_in,quantity_out,unit_cost,note,movement_date,organization_id) VALUES(x.product_id,'breakfast_entitlement',p_kitchen_order_id,0,x.qty,x.unit_cost,'Included room-package breakfast',now(),v_org);
    v_cost:=v_cost+x.qty*x.unit_cost;
  END LOOP;
  INSERT INTO hotel_breakfast_claims(organization_id,entitlement_id,kitchen_order_id,servings,claim_type,waiter_id,approved_by,override_reason,ingredient_cost) VALUES(v_org,e.id,p_kitchen_order_id,p_servings,CASE WHEN v_extra THEN 'complimentary_extra' ELSE 'included' END,auth.uid(),v_approver,NULLIF(trim(p_override_reason),''),v_cost);
  UPDATE hotel_breakfast_entitlements SET served_count=served_count+p_servings,actual_ingredient_cost=actual_ingredient_cost+v_cost,last_served_at=now(),status=CASE WHEN v_extra THEN 'complimentary_extra' WHEN served_count+p_servings>=GREATEST(eligible_count,1) THEN 'served' ELSE 'partially_served' END WHERE id=e.id;
  UPDATE kitchen_orders SET order_status='pending' WHERE id=p_kitchen_order_id;
  SELECT pos_cogs_kitchen_gl_account_id,pos_inventory_kitchen_gl_account_id INTO v_cogs,v_inv FROM journal_gl_settings WHERE organization_id=v_org;
  IF v_cost>0 AND v_cogs IS NOT NULL AND v_inv IS NOT NULL THEN v_jid:=create_journal_entry_atomic(e.service_date,'Breakfast COGS - included room package','breakfast_cogs',p_kitchen_order_id,auth.uid(),jsonb_build_array(jsonb_build_object('gl_account_id',v_cogs,'debit',v_cost,'credit',0,'line_description','Breakfast cost of sales'),jsonb_build_object('gl_account_id',v_inv,'debit',0,'credit',v_cost,'line_description','Kitchen food inventory')),v_org); END IF;
  RETURN jsonb_build_object('ok',true,'status',(SELECT status FROM hotel_breakfast_entitlements WHERE id=e.id),'ingredient_cost',v_cost,'journal_id',v_jid);
END $$;
REVOKE ALL ON FUNCTION public.serve_included_breakfast(uuid,uuid,integer,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.serve_included_breakfast(uuid,uuid,integer,text,text) TO authenticated;
