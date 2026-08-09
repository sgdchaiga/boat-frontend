-- Recipes improve stock costing but must not prevent a valid room-package meal.
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

  -- Only recipe-backed items create ingredient movements. Products without a
  -- recipe remain valid breakfast items and simply contribute no derived COGS.
  FOR x IN
    SELECT pri.ingredient_product_id product_id,SUM(pri.quantity_per_unit*koi.quantity) qty,MAX(COALESCE(p.cost_price,0)) unit_cost
    FROM kitchen_order_items koi JOIN product_recipe_items pri ON pri.product_id=koi.product_id
    JOIN products p ON p.id=pri.ingredient_product_id
    WHERE koi.order_id=p_kitchen_order_id GROUP BY pri.ingredient_product_id
  LOOP
    INSERT INTO product_stock_movements(product_id,source_type,source_id,quantity_in,quantity_out,unit_cost,note,movement_date,organization_id)
    VALUES(x.product_id,'breakfast_entitlement',p_kitchen_order_id,0,x.qty,x.unit_cost,'Included room-package breakfast',now(),v_org);
    v_cost:=v_cost+x.qty*x.unit_cost;
  END LOOP;
  INSERT INTO hotel_breakfast_claims(organization_id,entitlement_id,kitchen_order_id,servings,claim_type,waiter_id,approved_by,override_reason,ingredient_cost)
  VALUES(v_org,e.id,p_kitchen_order_id,p_servings,CASE WHEN v_extra THEN 'complimentary_extra' ELSE 'included' END,auth.uid(),v_approver,NULLIF(trim(p_override_reason),''),v_cost);
  UPDATE hotel_breakfast_entitlements SET served_count=served_count+p_servings,actual_ingredient_cost=actual_ingredient_cost+v_cost,last_served_at=now(),status=CASE WHEN v_extra THEN 'complimentary_extra' WHEN served_count+p_servings>=GREATEST(eligible_count,1) THEN 'served' ELSE 'partially_served' END WHERE id=e.id;
  UPDATE kitchen_orders SET order_status='pending' WHERE id=p_kitchen_order_id;
  SELECT pos_cogs_kitchen_gl_account_id,pos_inventory_kitchen_gl_account_id INTO v_cogs,v_inv FROM journal_gl_settings WHERE organization_id=v_org;
  IF v_cost>0 AND v_cogs IS NOT NULL AND v_inv IS NOT NULL THEN
    v_jid:=create_journal_entry_atomic(e.service_date,'Breakfast COGS - included room package','breakfast_cogs',p_kitchen_order_id,auth.uid(),jsonb_build_array(jsonb_build_object('gl_account_id',v_cogs,'debit',v_cost,'credit',0,'line_description','Breakfast cost of sales'),jsonb_build_object('gl_account_id',v_inv,'debit',0,'credit',v_cost,'line_description','Kitchen food inventory')),v_org);
  END IF;
  RETURN jsonb_build_object('ok',true,'status',(SELECT status FROM hotel_breakfast_entitlements WHERE id=e.id),'ingredient_cost',v_cost,'journal_id',v_jid);
END $$;
REVOKE ALL ON FUNCTION public.serve_included_breakfast(uuid,uuid,integer,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.serve_included_breakfast(uuid,uuid,integer,text,text) TO authenticated;
