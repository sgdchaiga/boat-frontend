BEGIN;
-- Existing charts are owned by their organizations. Never merge templates into them.
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS chart_of_accounts_source text;
UPDATE public.organizations SET chart_of_accounts_source = 'custom' WHERE chart_of_accounts_source IS NULL;
ALTER TABLE public.organizations ALTER COLUMN chart_of_accounts_source SET DEFAULT 'pending';
ALTER TABLE public.organizations ALTER COLUMN chart_of_accounts_source SET NOT NULL;
ALTER TABLE public.organizations ADD CONSTRAINT organizations_chart_source_check
  CHECK (chart_of_accounts_source IN ('pending', 'custom', 'template'));
ALTER TABLE public.gl_accounts ADD COLUMN IF NOT EXISTS account_source text;
COMMENT ON COLUMN public.gl_accounts.account_source IS 'custom: organization-owned account; template: explicitly adopted template; null: legacy provenance not yet established';

CREATE OR REPLACE FUNCTION public.mark_gl_account_source() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.account_source IS NULL THEN
    NEW.account_source := CASE WHEN current_setting('app.chart_template_initialization',true) = NEW.organization_id::text THEN 'template' ELSE 'custom' END;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER zz_mark_gl_account_source BEFORE INSERT ON public.gl_accounts
FOR EACH ROW EXECUTE FUNCTION public.mark_gl_account_source();

-- Preserve each existing function's business rules and permissions, but make all
-- automatic seeding/curation conditional on an explicit template choice.
DO $migration$
DECLARE f record; definition text; guard text;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname, p.prorettype::regtype::text AS result_type
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(ARRAY[
      'ensure_organization_standard_setup', 'seed_retail_chart_of_accounts',
      'seed_school_chart_of_accounts', 'seed_school_regular_expense_accounts',
      'seed_microfinance_chart_of_accounts', 'ensure_stock_adjustment_gl_accounts',
      'apply_business_type_gl_account_visibility', 'curate_school_chart_of_accounts',
      'curate_manufacturing_chart_of_accounts', 'seed_school_vote_structure'
    ])
  LOOP
    definition := pg_get_functiondef(f.oid);
    guard := E'BEGIN\n  IF current_setting(''app.chart_template_initialization'', true) IS DISTINCT FROM p_organization_id::text OR NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_organization_id AND chart_of_accounts_source = ''template'') THEN RETURN'
      || CASE WHEN f.result_type = 'integer' THEN ' 0' ELSE '' END || E'; END IF;\n';
    IF definition !~* '\mBEGIN\M' THEN RAISE EXCEPTION 'Cannot guard chart function %', f.proname; END IF;
    EXECUTE regexp_replace(definition, '\mBEGIN\M', guard, 'i');
  END LOOP;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.configure_initial_chart_of_accounts(
  p_organization_id uuid, p_source text, p_accounts jsonb DEFAULT '[]'::jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE organization_row public.organizations%ROWTYPE; row_data jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_platform_admin() AND NOT EXISTS (
    SELECT 1 FROM public.organization_members WHERE organization_id = p_organization_id
      AND user_id = auth.uid() AND is_active AND role IN ('admin', 'super_admin', 'owner')
  ) AND NOT EXISTS (
    SELECT 1 FROM public.staff WHERE id = auth.uid() AND organization_id = p_organization_id
      AND role IN ('admin', 'super_admin', 'owner')
  ) THEN RAISE EXCEPTION 'Only an organization administrator can configure its chart'; END IF;
  SELECT * INTO STRICT organization_row FROM public.organizations WHERE id = p_organization_id FOR UPDATE;
  IF organization_row.chart_of_accounts_source <> 'pending' OR EXISTS (
    SELECT 1 FROM public.gl_accounts WHERE organization_id = p_organization_id
  ) THEN RAISE EXCEPTION 'This organization already has a chart. Existing accounts cannot be replaced or merged with a template.'; END IF;
  IF p_source NOT IN ('template', 'custom') OR p_source IS NULL THEN RAISE EXCEPTION 'Choose a template or upload your own chart'; END IF;
  IF p_source = 'custom' THEN
    IF jsonb_typeof(p_accounts) IS DISTINCT FROM 'array' OR jsonb_array_length(p_accounts) NOT BETWEEN 1 AND 5000 THEN
      RAISE EXCEPTION 'Upload between 1 and 5000 accounts';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_accounts) r WHERE
      COALESCE(trim(r->>'account_code'),'') = '' OR COALESCE(trim(r->>'account_name'),'') = ''
      OR COALESCE(r->>'account_type','') NOT IN ('asset','liability','equity','income','expense')) THEN
      RAISE EXCEPTION 'Every account needs a code, name, and valid account type';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_accounts) r GROUP BY trim(r->>'account_code') HAVING count(*) > 1) THEN
      RAISE EXCEPTION 'Duplicate account codes in upload';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_accounts) r WHERE NULLIF(trim(r->>'parent_code'),'') IS NOT NULL AND
      (trim(r->>'parent_code') = trim(r->>'account_code') OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_accounts) parent WHERE trim(parent->>'account_code') = trim(r->>'parent_code')
      ))) THEN RAISE EXCEPTION 'Invalid parent account code'; END IF;
    IF EXISTS (
      WITH RECURSIVE tree AS (
        SELECT trim(r->>'account_code') AS code, NULLIF(trim(r->>'parent_code'),'') AS parent,
          ARRAY[trim(r->>'account_code')] AS path, false AS cycle FROM jsonb_array_elements(p_accounts) r
        UNION ALL
        SELECT t.code, NULLIF(trim(r->>'parent_code'),''), t.path || trim(r->>'account_code'), trim(r->>'account_code') = ANY(t.path)
        FROM tree t JOIN jsonb_array_elements(p_accounts) r ON trim(r->>'account_code') = t.parent WHERE NOT t.cycle
      ) SELECT 1 FROM tree WHERE cycle
    ) THEN RAISE EXCEPTION 'Parent accounts contain a cycle'; END IF;
  END IF;
  UPDATE public.organizations SET chart_of_accounts_source = p_source WHERE id = p_organization_id;
  IF p_source = 'template' THEN
    PERFORM set_config('app.chart_template_initialization', p_organization_id::text, true);
    -- School has its own chart; do not seed the generic chart first (code collisions).
    IF organization_row.business_type = 'school' THEN
      PERFORM public.seed_school_chart_of_accounts(p_organization_id);
      PERFORM public.seed_school_regular_expense_accounts(p_organization_id);
    ELSE
      PERFORM public.ensure_organization_standard_setup(p_organization_id, organization_row.business_type);
      PERFORM public.apply_business_type_gl_account_visibility(p_organization_id, organization_row.business_type);
      IF organization_row.business_type = 'manufacturing' THEN PERFORM public.curate_manufacturing_chart_of_accounts(p_organization_id); END IF;
    END IF;
  ELSE
    INSERT INTO public.gl_accounts(organization_id, account_code, account_name, account_type, category, business_type, is_active)
    SELECT p_organization_id, trim(r->>'account_code'), trim(r->>'account_name'), r->>'account_type',
      NULLIF(trim(r->>'category'),''), organization_row.business_type, COALESCE((r->>'is_active')::boolean,true)
    FROM jsonb_array_elements(p_accounts) r;
    UPDATE public.gl_accounts g SET parent_id = parent.id
    FROM jsonb_array_elements(p_accounts) r JOIN public.gl_accounts parent
      ON parent.organization_id = p_organization_id AND parent.account_code = trim(r->>'parent_code')
    WHERE g.organization_id = p_organization_id AND g.account_code = trim(r->>'account_code');
  END IF;
  PERFORM set_config('app.chart_template_initialization', '', true);
END;
$$;
REVOKE ALL ON FUNCTION public.configure_initial_chart_of_accounts(uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.configure_initial_chart_of_accounts(uuid,text,jsonb) TO authenticated, service_role;

-- Configure the chosen chart inside the same transaction as workspace creation.
DO $migration$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO STRICT definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='create_self_service_organization';
  IF position('RETURN jsonb_build_object(' IN definition) = 0 THEN RAISE EXCEPTION 'Unexpected onboarding function'; END IF;
  definition := replace(definition, 'RETURN jsonb_build_object(', E'PERFORM public.configure_initial_chart_of_accounts(v_org_id, COALESCE(p_answers->>''chart_of_accounts_source'', ''template''), COALESCE(p_answers->''chart_accounts'', ''[]''::jsonb));\n  RETURN jsonb_build_object(');
  EXECUTE definition;
END;
$migration$;

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

ROLLBACK;