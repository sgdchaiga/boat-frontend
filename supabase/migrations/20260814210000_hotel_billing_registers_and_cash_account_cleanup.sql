-- Tenant-safe hotel billing registers resolve legacy tenant stamps through the
-- stay, which is the authoritative organization relationship.

CREATE OR REPLACE FUNCTION public.get_hotel_billing_register(p_from date DEFAULT NULL,p_to date DEFAULT NULL)
RETURNS TABLE(id uuid,stay_id uuid,description text,charge_type text,amount numeric,charged_at timestamptz,created_by uuid,stay_night_date date,auto_charge_source text,room_number text,guest_first_name text,guest_last_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.staff WHERE id=auth.uid() AND COALESCE(is_active,true);
  IF v_org IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='No active hotel organization is linked to this user.'; END IF;
  RETURN QUERY SELECT b.id,b.stay_id,b.description,b.charge_type,b.amount,b.charged_at,b.created_by,b.stay_night_date,b.auto_charge_source,
    rm.room_number,c.first_name,c.last_name
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

CREATE OR REPLACE FUNCTION public.get_hotel_room_reconciliation_register()
RETURNS TABLE(stay_id uuid,actual_check_in timestamptz,actual_check_out timestamptz,room_number text,guest_first_name text,guest_last_name text,first_billing_date date,last_billing_date date,expected_nights integer,charged_nights integer,billed numeric,paid numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.staff WHERE id=auth.uid() AND COALESCE(is_active,true);
  IF v_org IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='No active hotel organization is linked to this user.'; END IF;
  RETURN QUERY
  SELECT s.id,s.actual_check_in,s.actual_check_out,rm.room_number,c.first_name,c.last_name,
    ba.first_date,ba.last_date,
    CASE WHEN s.actual_check_in IS NULL THEN 0 ELSE greatest(1,ceil(extract(epoch FROM (COALESCE(s.actual_check_out,now())-s.actual_check_in))/86400.0)::integer) END,
    COALESCE(ba.nights,0)::integer,COALESCE(ba.total,0),COALESCE(pa.total,0)
  FROM public.stays s
  LEFT JOIN public.rooms rm ON rm.id=s.room_id
  LEFT JOIN public.hotel_customers c ON c.id=s.property_customer_id
  LEFT JOIN LATERAL (SELECT min(b.charged_at::date) first_date,max(b.charged_at::date) last_date,count(DISTINCT COALESCE(b.stay_night_date,b.charged_at::date)) FILTER(WHERE b.charge_type='room') nights,sum(b.amount) total FROM public.billing b WHERE b.stay_id=s.id) ba ON true
  LEFT JOIN LATERAL (SELECT sum(p.amount) total FROM public.payments p WHERE p.stay_id=s.id AND p.payment_status='completed') pa ON true
  WHERE s.organization_id=v_org
  ORDER BY s.actual_check_in DESC,s.id DESC;
END $$;
REVOKE ALL ON FUNCTION public.get_hotel_room_reconciliation_register() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_hotel_room_reconciliation_register() TO authenticated;

-- Retire only unused, zero-history duplicate physical cash accounts in hotel
-- charts. Posted or referenced accounts are never altered.
WITH candidates AS (
  SELECT g.id,row_number() OVER(PARTITION BY g.organization_id,regexp_replace(lower(g.account_name),'[^a-z0-9]+','','g') ORDER BY CASE WHEN g.account_code='1010' THEN 0 ELSE 1 END,g.created_at,g.id) rn
  FROM public.gl_accounts g JOIN public.organizations o ON o.id=g.organization_id
  WHERE o.business_type IN ('hotel','mixed') AND g.is_active=true AND regexp_replace(lower(g.account_name),'[^a-z0-9]+','','g')='cashonhand'
), unused AS (
  SELECT c.id FROM candidates c WHERE c.rn>1
    AND NOT EXISTS(SELECT 1 FROM public.journal_entry_lines l WHERE l.gl_account_id=c.id)
    AND NOT EXISTS(SELECT 1 FROM public.journal_gl_settings s WHERE c.id IN (s.cash_gl_account_id,s.receivable_gl_account_id,s.revenue_gl_account_id))
)
UPDATE public.gl_accounts g SET is_active=false WHERE g.id IN (SELECT id FROM unused);
