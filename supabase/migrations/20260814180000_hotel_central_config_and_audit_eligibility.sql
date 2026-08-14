-- Central hotel configuration and one authoritative night-audit eligibility rule.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS hotel_config jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.organizations
SET hotel_config = jsonb_strip_nulls(jsonb_build_object(
  'hotel_name', name,
  'address', address,
  'currency', COALESCE(NULLIF(hotel_config->>'currency',''), 'UGX'),
  'timezone', COALESCE(NULLIF(hotel_config->>'timezone',''), hotel_timezone, 'UTC')
)) || hotel_config
WHERE business_type IN ('hotel','mixed');

CREATE OR REPLACE FUNCTION public.save_organization_hotel_config(p_config jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE v_org uuid; v_clean jsonb;
BEGIN
  SELECT organization_id INTO v_org FROM public.staff
  WHERE id=auth.uid() AND COALESCE(is_active,true)
    AND role IN ('super_admin','admin','manager');
  IF v_org IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Not authorized to change hotel configuration.'; END IF;
  IF COALESCE(jsonb_typeof(p_config),'null') <> 'object' THEN RAISE EXCEPTION 'Hotel configuration must be an object.'; END IF;
  v_clean := jsonb_strip_nulls(jsonb_build_object(
    'hotel_name', left(COALESCE(p_config->>'hotel_name',''),160),
    'address', left(COALESCE(p_config->>'address',''),500),
    'phone', left(COALESCE(p_config->>'phone',''),80),
    'email', left(COALESCE(p_config->>'email',''),160),
    'currency', upper(left(COALESCE(NULLIF(p_config->>'currency',''),'UGX'),3)),
    'timezone', left(COALESCE(NULLIF(p_config->>'timezone',''),'UTC'),80),
    'pos_table_session_mode', CASE WHEN p_config->>'pos_table_session_mode'='auto' THEN 'auto' ELSE 'manual' END,
    'pos_kitchen_status_flow', COALESCE(p_config->'pos_kitchen_status_flow','["pending","preparing","ready","served"]'::jsonb),
    'pos_bar_status_flow', COALESCE(p_config->'pos_bar_status_flow','["pending","preparing","ready","served"]'::jsonb),
    'pos_kitchen_orders_department_id', p_config->'pos_kitchen_orders_department_id',
    'pos_bar_department_id', p_config->'pos_bar_department_id',
    'pos_sauna_department_id', p_config->'pos_sauna_department_id'
  ));
  UPDATE public.organizations SET hotel_config=v_clean,
    address=NULLIF(v_clean->>'address',''), hotel_timezone=COALESCE(NULLIF(v_clean->>'timezone',''),hotel_timezone)
  WHERE id=v_org;
  RETURN v_clean;
END $$;

REVOKE ALL ON FUNCTION public.save_organization_hotel_config(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_organization_hotel_config(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.organization_is_hotel_enabled(p_organization_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.organizations o
    WHERE o.id=p_organization_id
      AND o.business_type IN ('hotel','mixed')
      AND COALESCE(o.hotel_enable_smart_room_charges,true)
  )
$$;
REVOKE ALL ON FUNCTION public.organization_is_hotel_enabled(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.organization_is_hotel_enabled(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.eligible_hotel_night_audit_organizations()
RETURNS TABLE(id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT o.id FROM public.organizations o
  WHERE public.organization_is_hotel_enabled(o.id)
$$;
REVOKE ALL ON FUNCTION public.eligible_hotel_night_audit_organizations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eligible_hotel_night_audit_organizations() TO service_role;

CREATE OR REPLACE FUNCTION public.run_due_hotel_night_audits() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o record; v_local_date date; v_result jsonb; v_count int:=0;
BEGIN
  FOR o IN SELECT id,COALESCE(hotel_timezone,'UTC') tz,COALESCE(hotel_night_audit_time,'02:00') audit_time
    FROM organizations
    WHERE public.organization_is_hotel_enabled(id)
  LOOP
    v_local_date := (now() AT TIME ZONE o.tz)::date;
    IF (now() AT TIME ZONE o.tz)::time >= o.audit_time AND NOT EXISTS(
      SELECT 1 FROM hotel_night_audit_runs r WHERE r.organization_id=o.id AND r.last_local_run_date>=v_local_date
    ) THEN
      v_result := run_hotel_night_audit_for_org(o.id,v_local_date-1,NULL);
      INSERT INTO hotel_night_audit_runs(organization_id,last_local_run_date,last_run_at,result)
      VALUES(o.id,v_local_date,now(),v_result) ON CONFLICT(organization_id) DO UPDATE
      SET last_local_run_date=EXCLUDED.last_local_run_date,last_run_at=now(),result=EXCLUDED.result;
      v_count:=v_count+1;
    END IF;
  END LOOP;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.run_due_hotel_night_audits() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_due_hotel_night_audits() TO service_role;
