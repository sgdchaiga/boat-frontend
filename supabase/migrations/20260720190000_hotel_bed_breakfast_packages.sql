-- Bed & Breakfast room packages: allocation, entitlement, fulfilment and reporting.
-- Included breakfasts are deliberately not payments, billings, or zero-value POS sales.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS breakfast_closing_time time NOT NULL DEFAULT '10:30:00';

CREATE TABLE IF NOT EXISTS public.hotel_rate_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  includes_breakfast boolean NOT NULL DEFAULT false,
  breakfast_allocation_adult numeric(12,2) NOT NULL DEFAULT 0 CHECK (breakfast_allocation_adult >= 0),
  breakfast_allocation_child numeric(12,2) NOT NULL DEFAULT 0 CHECK (breakfast_allocation_child >= 0),
  adults_eligible boolean NOT NULL DEFAULT true,
  children_eligible boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  accommodation_revenue_gl_account_id uuid REFERENCES public.gl_accounts(id),
  breakfast_revenue_gl_account_id uuid REFERENCES public.gl_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.staff(id),
  UNIQUE (organization_id, code)
);

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS rate_plan_id uuid REFERENCES public.hotel_rate_plans(id),
  ADD COLUMN IF NOT EXISTS number_of_adults integer NOT NULL DEFAULT 1 CHECK (number_of_adults >= 0),
  ADD COLUMN IF NOT EXISTS number_of_children integer NOT NULL DEFAULT 0 CHECK (number_of_children >= 0);
ALTER TABLE public.stays ADD COLUMN IF NOT EXISTS rate_plan_id uuid REFERENCES public.hotel_rate_plans(id);
ALTER TABLE public.billing
  ADD COLUMN IF NOT EXISTS rate_plan_id uuid REFERENCES public.hotel_rate_plans(id),
  ADD COLUMN IF NOT EXISTS accommodation_revenue_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS breakfast_revenue_amount numeric(12,2);

CREATE TABLE IF NOT EXISTS public.hotel_breakfast_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  stay_id uuid NOT NULL REFERENCES public.stays(id) ON DELETE CASCADE,
  billing_id uuid REFERENCES public.billing(id) ON DELETE SET NULL,
  rate_plan_id uuid NOT NULL REFERENCES public.hotel_rate_plans(id),
  service_date date NOT NULL,
  eligible_adults integer NOT NULL DEFAULT 0 CHECK (eligible_adults >= 0),
  eligible_children integer NOT NULL DEFAULT 0 CHECK (eligible_children >= 0),
  eligible_count integer NOT NULL CHECK (eligible_count >= 0),
  served_count integer NOT NULL DEFAULT 0 CHECK (served_count >= 0),
  allocated_revenue numeric(12,2) NOT NULL DEFAULT 0 CHECK (allocated_revenue >= 0),
  actual_ingredient_cost numeric(12,2) NOT NULL DEFAULT 0 CHECK (actual_ingredient_cost >= 0),
  status text NOT NULL DEFAULT 'available' CHECK (status IN
    ('available','served','partially_served','not_claimed','waived_discounted','complimentary_extra')),
  last_served_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stay_id, service_date)
);

CREATE TABLE IF NOT EXISTS public.hotel_breakfast_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entitlement_id uuid NOT NULL REFERENCES public.hotel_breakfast_entitlements(id),
  kitchen_order_id uuid NOT NULL UNIQUE REFERENCES public.kitchen_orders(id),
  servings integer NOT NULL CHECK (servings > 0),
  claim_type text NOT NULL DEFAULT 'included' CHECK (claim_type IN ('included','complimentary_extra','manager_override')),
  waiter_id uuid REFERENCES public.staff(id),
  approved_by uuid REFERENCES public.staff(id),
  override_reason text,
  ingredient_cost numeric(12,2) NOT NULL DEFAULT 0,
  served_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_breakfast_entitlements_org_date ON public.hotel_breakfast_entitlements(organization_id, service_date, status);
CREATE INDEX IF NOT EXISTS idx_breakfast_claims_org_served ON public.hotel_breakfast_claims(organization_id, served_at);

ALTER TABLE public.hotel_rate_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_breakfast_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_breakfast_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY hotel_rate_plans_org_read ON public.hotel_rate_plans FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM public.staff WHERE id = auth.uid()) OR public.is_platform_admin());
CREATE POLICY hotel_rate_plans_manager_write ON public.hotel_rate_plans FOR ALL TO authenticated
  USING (organization_id = (SELECT organization_id FROM public.staff WHERE id = auth.uid()) AND
    EXISTS (SELECT 1 FROM public.staff WHERE id=auth.uid() AND role IN ('admin','manager','super_admin')))
  WITH CHECK (organization_id = (SELECT organization_id FROM public.staff WHERE id = auth.uid()) AND
    EXISTS (SELECT 1 FROM public.staff WHERE id=auth.uid() AND role IN ('admin','manager','super_admin')));
CREATE POLICY breakfast_entitlements_org_read ON public.hotel_breakfast_entitlements FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM public.staff WHERE id = auth.uid()) OR public.is_platform_admin());
CREATE POLICY breakfast_claims_org_read ON public.hotel_breakfast_claims FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM public.staff WHERE id = auth.uid()) OR public.is_platform_admin());

-- Generate the breakfast following an occupied package night. Safe to call repeatedly.
CREATE OR REPLACE FUNCTION public.generate_hotel_breakfast_entitlement(p_billing_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b record; rp record; v_adults int; v_children int; v_id uuid;
BEGIN
  SELECT bi.*, s.reservation_id, COALESCE(s.rate_plan_id, bi.rate_plan_id, r.rate_plan_id) effective_plan
    INTO b FROM billing bi JOIN stays s ON s.id=bi.stay_id
    LEFT JOIN reservations r ON r.id=s.reservation_id WHERE bi.id=p_billing_id FOR UPDATE;
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

CREATE OR REPLACE FUNCTION public.trg_generate_breakfast_entitlement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN PERFORM generate_hotel_breakfast_entitlement(NEW.id); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_billing_generate_breakfast ON public.billing;
CREATE TRIGGER trg_billing_generate_breakfast AFTER INSERT ON public.billing
FOR EACH ROW WHEN (NEW.charge_type='room') EXECUTE FUNCTION public.trg_generate_breakfast_entitlement();

-- The room poster creates its journal after billing. Split that existing credit into the
-- two package revenue accounts without changing the guest receivable or package total.
CREATE OR REPLACE FUNCTION public.trg_split_breakfast_room_revenue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b record; v_breakfast_gl uuid; v_accommodation_gl uuid;
BEGIN
  IF NEW.credit<=0 OR COALESCE(NEW.line_description,'')='Breakfast package revenue' THEN RETURN NEW; END IF;
  SELECT bi.*,rp.breakfast_revenue_gl_account_id,rp.accommodation_revenue_gl_account_id INTO b FROM journal_entries je
    JOIN billing bi ON bi.id=je.reference_id LEFT JOIN hotel_rate_plans rp ON rp.id=bi.rate_plan_id
    WHERE je.id=NEW.journal_entry_id AND je.reference_type='room_charge' AND bi.breakfast_revenue_amount>0;
  IF NOT FOUND THEN RETURN NEW; END IF;
  v_breakfast_gl:=COALESCE(b.breakfast_revenue_gl_account_id,NEW.gl_account_id);
  v_accommodation_gl:=COALESCE(b.accommodation_revenue_gl_account_id,NEW.gl_account_id);
  UPDATE journal_entry_lines SET gl_account_id=v_accommodation_gl,credit=LEAST(NEW.credit,COALESCE(b.accommodation_revenue_amount,NEW.credit)) WHERE id=NEW.id;
  INSERT INTO journal_entry_lines(journal_entry_id,gl_account_id,debit,credit,line_description,sort_order,dimensions)
    VALUES(NEW.journal_entry_id,v_breakfast_gl,0,LEAST(NEW.credit,b.breakfast_revenue_amount),'Breakfast package revenue',NEW.sort_order+1,COALESCE(NEW.dimensions,'{}'));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_split_breakfast_room_revenue ON public.journal_entry_lines;
CREATE TRIGGER trg_split_breakfast_room_revenue AFTER INSERT ON public.journal_entry_lines
FOR EACH ROW EXECUTE FUNCTION public.trg_split_breakfast_room_revenue();

-- Atomically validates and consumes an entitlement, deducts recipe ingredients, and posts COGS only.
CREATE OR REPLACE FUNCTION public.serve_included_breakfast(
  p_entitlement_id uuid, p_kitchen_order_id uuid, p_servings integer,
  p_manager_pin text DEFAULT NULL, p_override_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE e record; st record; v_org uuid; v_role text; v_approver uuid; v_extra boolean:=false; v_cost numeric(12,2):=0; x record; v_jid uuid; v_cogs uuid; v_inv uuid;
BEGIN
  SELECT organization_id,role INTO v_org,v_role FROM staff WHERE id=auth.uid() AND is_active;
  SELECT be.*, o.breakfast_closing_time INTO e FROM hotel_breakfast_entitlements be JOIN organizations o ON o.id=be.organization_id
    WHERE be.id=p_entitlement_id FOR UPDATE;
  IF NOT FOUND OR e.organization_id IS DISTINCT FROM v_org THEN RAISE EXCEPTION 'Breakfast entitlement not found'; END IF;
  SELECT s.*, r.check_out_date INTO st FROM stays s LEFT JOIN reservations r ON r.id=s.reservation_id WHERE s.id=e.stay_id;
  IF st.actual_check_out IS NOT NULL OR st.room_id IS DISTINCT FROM (SELECT room_id FROM kitchen_orders WHERE id=p_kitchen_order_id) THEN
    RAISE EXCEPTION 'Room does not have the matching active stay'; END IF;
  IF e.service_date IS DISTINCT FROM ((now() AT TIME ZONE COALESCE((SELECT hotel_timezone FROM organizations WHERE id=v_org),'UTC'))::date) THEN
    RAISE EXCEPTION 'Entitlement is not valid for today'; END IF;
  IF p_servings IS NULL OR p_servings<1 THEN RAISE EXCEPTION 'Servings must be positive'; END IF;
  IF e.served_count+p_servings>e.eligible_count OR e.status IN ('served','not_claimed') THEN v_extra:=true; END IF;
  IF v_extra THEN
    IF COALESCE(trim(p_override_reason),'')='' OR p_manager_pin IS NULL THEN RAISE EXCEPTION 'Manager approval and audit reason required'; END IF;
    SELECT p.staff_id INTO v_approver FROM pos_manager_pin_hashes p JOIN staff s ON s.id=p.staff_id
      WHERE p.organization_id=v_org AND s.role IN ('admin','manager','super_admin') AND crypt(p_manager_pin,p.pin_hash)=p.pin_hash LIMIT 1;
    IF v_approver IS NULL THEN RAISE EXCEPTION 'Manager approval failed'; END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM hotel_breakfast_claims WHERE kitchen_order_id=p_kitchen_order_id) THEN RAISE EXCEPTION 'Kitchen order already claimed'; END IF;
  IF EXISTS(SELECT 1 FROM kitchen_order_items koi WHERE koi.order_id=p_kitchen_order_id AND NOT EXISTS
    (SELECT 1 FROM product_recipe_items pri WHERE pri.product_id=koi.product_id)) THEN
    RAISE EXCEPTION 'Every included breakfast item must have a configured recipe';
  END IF;
  FOR x IN SELECT pri.ingredient_product_id product_id, SUM(pri.quantity_per_unit*koi.quantity) qty, MAX(COALESCE(p.cost_price,0)) unit_cost
    FROM kitchen_order_items koi JOIN product_recipe_items pri ON pri.product_id=koi.product_id
    JOIN products p ON p.id=pri.ingredient_product_id WHERE koi.order_id=p_kitchen_order_id GROUP BY pri.ingredient_product_id
  LOOP
    INSERT INTO product_stock_movements(product_id,source_type,source_id,quantity_in,quantity_out,unit_cost,note,movement_date,organization_id)
      VALUES(x.product_id,'breakfast_entitlement',p_kitchen_order_id,0,x.qty,x.unit_cost,'Included room-package breakfast',now(),v_org);
    v_cost:=v_cost+x.qty*x.unit_cost;
  END LOOP;
  INSERT INTO hotel_breakfast_claims(organization_id,entitlement_id,kitchen_order_id,servings,claim_type,waiter_id,approved_by,override_reason,ingredient_cost)
    VALUES(v_org,e.id,p_kitchen_order_id,p_servings,CASE WHEN v_extra THEN 'complimentary_extra' ELSE 'included' END,auth.uid(),v_approver,NULLIF(trim(p_override_reason),''),v_cost);
  UPDATE hotel_breakfast_entitlements SET served_count=served_count+p_servings,actual_ingredient_cost=actual_ingredient_cost+v_cost,last_served_at=now(),
    status=CASE WHEN v_extra THEN 'complimentary_extra' WHEN served_count+p_servings>=eligible_count THEN 'served' ELSE 'partially_served' END WHERE id=e.id;
  UPDATE kitchen_orders SET order_status='pending' WHERE id=p_kitchen_order_id;
  SELECT pos_cogs_kitchen_gl_account_id,pos_inventory_kitchen_gl_account_id INTO v_cogs,v_inv FROM journal_gl_settings WHERE organization_id=v_org;
  IF v_cost>0 AND v_cogs IS NOT NULL AND v_inv IS NOT NULL THEN
    v_jid:=create_journal_entry_atomic(e.service_date,'Breakfast COGS - included room package','breakfast_cogs',p_kitchen_order_id,auth.uid(),
      jsonb_build_array(jsonb_build_object('gl_account_id',v_cogs,'debit',v_cost,'credit',0,'line_description','Breakfast cost of sales'),
                        jsonb_build_object('gl_account_id',v_inv,'debit',0,'credit',v_cost,'line_description','Kitchen food inventory')),v_org);
  END IF;
  RETURN jsonb_build_object('ok',true,'status',(SELECT status FROM hotel_breakfast_entitlements WHERE id=e.id),'ingredient_cost',v_cost,'journal_id',v_jid);
END $$;
REVOKE ALL ON FUNCTION public.serve_included_breakfast(uuid,uuid,integer,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.serve_included_breakfast(uuid,uuid,integer,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.close_unused_breakfast_entitlements(p_organization_id uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n int; BEGIN
  UPDATE hotel_breakfast_entitlements e SET status='not_claimed',closed_at=now()
  FROM organizations o WHERE o.id=e.organization_id AND e.status='available' AND e.served_count=0
    AND (p_organization_id IS NULL OR e.organization_id=p_organization_id)
    AND now() >= ((e.service_date+o.breakfast_closing_time) AT TIME ZONE COALESCE(o.hotel_timezone,'UTC'));
  GET DIAGNOSTICS n=ROW_COUNT; RETURN n; END $$;
GRANT EXECUTE ON FUNCTION public.close_unused_breakfast_entitlements(uuid) TO authenticated,service_role;

CREATE OR REPLACE VIEW public.hotel_breakfast_performance AS
SELECT e.organization_id,e.service_date,e.stay_id,s.room_id,rm.room_number,s.guest_id,
  trim(concat(c.first_name,' ',c.last_name)) guest_name,e.status,e.eligible_count,e.served_count,
  e.allocated_revenue,e.actual_ingredient_cost,e.allocated_revenue-e.actual_ingredient_cost gross_profit,
  CASE WHEN e.eligible_count>0 THEN round(100.0*LEAST(e.served_count,e.eligible_count)/e.eligible_count,2) ELSE 0 END uptake_percentage,
  cl.waiter_id,w.full_name waiter_name,cl.claim_type,cl.kitchen_order_id
FROM hotel_breakfast_entitlements e JOIN stays s ON s.id=e.stay_id JOIN rooms rm ON rm.id=s.room_id
LEFT JOIN hotel_customers c ON c.id=s.guest_id LEFT JOIN hotel_breakfast_claims cl ON cl.entitlement_id=e.id
LEFT JOIN staff w ON w.id=cl.waiter_id;
GRANT SELECT ON public.hotel_breakfast_performance TO authenticated;

CREATE OR REPLACE VIEW public.hotel_breakfast_package_summary AS
SELECT organization_id,service_date,
  count(*) packages_sold,count(*) entitlements_generated,
  sum(eligible_count) eligible_breakfasts,
  sum(LEAST(served_count,eligible_count)) breakfasts_served,
  sum(CASE WHEN status='not_claimed' THEN eligible_count ELSE 0 END) breakfasts_not_claimed,
  sum(CASE WHEN status='complimentary_extra' THEN GREATEST(served_count-eligible_count,1) ELSE 0 END) complimentary_and_extra,
  round(100.0*sum(LEAST(served_count,eligible_count))/NULLIF(sum(eligible_count),0),2) breakfast_uptake_percentage,
  sum(allocated_revenue) allocated_breakfast_revenue,sum(actual_ingredient_cost) actual_ingredient_cost,
  round(sum(actual_ingredient_cost)/NULLIF(sum(served_count),0),2) cost_per_breakfast_served,
  sum(allocated_revenue)-sum(actual_ingredient_cost) breakfast_gross_profit
FROM hotel_breakfast_entitlements GROUP BY organization_id,service_date;
GRANT SELECT ON public.hotel_breakfast_package_summary TO authenticated;
