-- Execute after the migration in a transaction that is ALWAYS rolled back.
DO $$
DECLARE custom_org uuid; template_org uuid; school_org uuid; account_count integer;
BEGIN
  INSERT INTO public.organizations(name,slug,business_type) VALUES ('Chart test custom', gen_random_uuid()::text, 'manufacturing') RETURNING id INTO custom_org;
  IF EXISTS(SELECT 1 FROM public.gl_accounts WHERE organization_id=custom_org) THEN RAISE EXCEPTION 'Pending organization was auto-seeded'; END IF;
  PERFORM public.configure_initial_chart_of_accounts(custom_org,'custom','[{"account_code":"001","account_name":"Original Assets","account_type":"asset"},{"account_code":"0011","account_name":"My School Supplies","account_type":"asset","parent_code":"001"}]');
  PERFORM public.ensure_organization_standard_setup(custom_org,'manufacturing');
  UPDATE public.organizations SET business_type='school' WHERE id=custom_org;
  SELECT count(*) INTO account_count FROM public.gl_accounts WHERE organization_id=custom_org;
  IF account_count<>2 THEN RAISE EXCEPTION 'Custom chart mixed with template'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.gl_accounts WHERE organization_id=custom_org AND account_code='0011' AND parent_id IS NOT NULL AND account_source='custom') THEN RAISE EXCEPTION 'Custom hierarchy/provenance lost'; END IF;
  BEGIN
    PERFORM public.configure_initial_chart_of_accounts(custom_org,'template');
    RAISE EXCEPTION 'Test failed: existing chart accepted template';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'This organization already has a chart%' THEN RAISE; END IF;
  END;
  INSERT INTO public.organizations(name,slug,business_type) VALUES ('Chart test template',gen_random_uuid()::text,'manufacturing') RETURNING id INTO template_org;
  PERFORM public.configure_initial_chart_of_accounts(template_org,'template');
  IF NOT EXISTS(SELECT 1 FROM public.gl_accounts WHERE organization_id=template_org AND account_name='Raw Materials Inventory' AND account_source='template') THEN RAISE EXCEPTION 'Manufacturing template missing'; END IF;
  SELECT count(*) INTO account_count FROM public.gl_accounts WHERE organization_id=template_org;
  UPDATE public.organizations SET business_type='school' WHERE id=template_org;
  IF (SELECT count(*) FROM public.gl_accounts WHERE organization_id=template_org)<>account_count THEN RAISE EXCEPTION 'Business type change merged another template'; END IF;
  INSERT INTO public.organizations(name,slug,business_type) VALUES ('Chart test school',gen_random_uuid()::text,'school') RETURNING id INTO school_org;
  PERFORM public.configure_initial_chart_of_accounts(school_org,'template');
  IF EXISTS(SELECT 1 FROM public.gl_accounts WHERE organization_id=school_org AND account_name='Raw Materials Inventory') THEN RAISE EXCEPTION 'School template mixed with manufacturing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.gl_accounts WHERE organization_id=school_org AND account_name='Tuition Fees') THEN RAISE EXCEPTION 'School template missing'; END IF;
END;
$$;
