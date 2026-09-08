-- Tighten optional PMS write access after the base tables are installed.
DO $$ DECLARE t text; policy_name text; BEGIN
  FOREACH t IN ARRAY ARRAY['hotel_pms_room_blocks','hotel_pms_rate_controls','hotel_pms_guest_deposits','hotel_pms_work_orders','hotel_pms_inspections','hotel_pms_period_closes'] LOOP
    policy_name := 'pms_org_access_'||t;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',policy_name,t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I','pms_read_'||t,t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I','pms_write_'||t,t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_platform_admin() OR organization_id IN (SELECT s.organization_id FROM public.staff s WHERE s.id=auth.uid() AND COALESCE(s.is_active,true)))','pms_read_'||t,t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_platform_admin() OR organization_id IN (SELECT s.organization_id FROM public.staff s WHERE s.id=auth.uid() AND COALESCE(s.is_active,true) AND s.role IN (''super_admin'',''admin'',''manager'',''receptionist'',''accountant'',''supervisor''))) WITH CHECK (public.is_platform_admin() OR organization_id IN (SELECT s.organization_id FROM public.staff s WHERE s.id=auth.uid() AND COALESCE(s.is_active,true) AND s.role IN (''super_admin'',''admin'',''manager'',''receptionist'',''accountant'',''supervisor'')))','pms_write_'||t,t);
  END LOOP;
END $$;
