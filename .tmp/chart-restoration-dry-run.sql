BEGIN;
-- Existing charts are owned by their organizations. Never merge templates into them.
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS chart_of_accounts_source text;
UPDATE public.organizations SET chart_of_accounts_source = 'custom' WHERE chart_of_accounts_source IS NULL;
ALTER TABLE public.organizations ALTER COLUMN chart_of_accounts_source SET DEFAULT 'pending';
ALTER TABLE public.organizations ALTER COLUMN chart_of_accounts_source SET NOT NULL;
ALTER TABLE public.organizations ADD CONSTRAINT organizations_chart_source_check
  CHECK (chart_of_accounts_source IN ('pending', 'custom', 'template'));
-- A profile edit must not relabel the organization's existing accounts either.
DROP TRIGGER IF EXISTS trg_sync_gl_account_business_type ON public.organizations;
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

-- Audited 2026-09-07: these 12 organizations had established charts before
-- the 2026-07-09 09:01:31.177489 UTC bulk template insertion.
-- Never delete accounts, change journal history, or guess replacement mappings.
CREATE TABLE IF NOT EXISTS public.chart_restoration_audit (
  account_id uuid PRIMARY KEY, organization_id uuid NOT NULL,
  original_account jsonb NOT NULL, reference_details jsonb NOT NULL DEFAULT '[]',
  action text NOT NULL, restored_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.chart_restoration_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chart_restoration_audit FROM anon, authenticated;
CREATE TEMP TABLE chart_restore_organizations(id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO chart_restore_organizations VALUES
  ('a22903cd-062f-4609-901c-f343f1bc6359'::uuid),
  ('41d4cf62-5b33-4d64-8534-8667119f5607'::uuid),
  ('4b550bfd-14a1-4cb3-a873-77d210a55f00'::uuid),
  ('ae7504f9-6d38-46bf-94a9-0c004897de92'::uuid),
  ('c471637e-fa72-429d-9616-70cde85fe2b6'::uuid),
  ('e91883e2-c3b4-45f6-95e9-5b3d01abfda9'::uuid),
  ('6c8d181c-f14c-4c30-aa46-209d7a896226'::uuid),
  ('db4b6aaf-a693-43af-9889-f80cbf56f94f'::uuid),
  ('b1a3d17f-6fe7-4154-9577-96813915cb48'::uuid),
  ('53653d93-5627-43ea-8215-10e2a9c8de35'::uuid),
  ('89b3a6d0-c46f-40b2-ba5f-2240c8be62bc'::uuid),
  ('324aa9c8-1790-4449-b83a-526ec3ad547d'::uuid);

-- Snapshot the complete account before making reversible visibility changes.
INSERT INTO public.chart_restoration_audit(account_id,organization_id,original_account,action)
SELECT g.id,g.organization_id,to_jsonb(g),'review'
FROM public.gl_accounts g JOIN chart_restore_organizations o ON o.id=g.organization_id
WHERE g.created_at='2026-07-09T09:01:31.177489Z'::timestamptz
ON CONFLICT(account_id) DO NOTHING;

DO $$
DECLARE ref record;
BEGIN
  FOR ref IN
    SELECT DISTINCT c.conrelid::regclass::text AS table_name,a.attname AS column_name
    FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
    WHERE c.contype='f' AND c.confrelid='public.gl_accounts'::regclass
    UNION
    SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema='public' AND (
      (table_name='products' AND column_name IN ('stock_account','income_account','purchases_account'))
      OR (table_name='journal_gl_department_settings' AND column_name LIKE '%gl_account_id')
    )
  LOOP
    EXECUTE format(
      'UPDATE public.chart_restoration_audit a SET reference_details = a.reference_details || jsonb_build_array(jsonb_build_object(''table'',$1,''column'',$2,''count'',used.n)) FROM (SELECT t.%I::text AS id,count(*) AS n FROM %s t JOIN public.chart_restoration_audit candidate ON candidate.account_id::text=t.%I::text WHERE candidate.action=''review'' GROUP BY t.%I) used WHERE a.account_id::text=used.id AND a.action=''review''',
      ref.column_name,ref.table_name::regclass,ref.column_name,ref.column_name
    ) USING ref.table_name,ref.column_name;
  END LOOP;
  UPDATE public.chart_restoration_audit SET action=CASE WHEN jsonb_array_length(reference_details)=0
    THEN 'deactivated_unused_template' ELSE 'retained_referenced_template' END WHERE action='review';
END;
$$;
UPDATE public.gl_accounts g SET is_active=false,account_source='template'
FROM public.chart_restoration_audit a WHERE a.account_id=g.id AND a.action='deactivated_unused_template';
-- Original charts stay authoritative in account pickers even when a name resembles another industry.
UPDATE public.gl_accounts g SET account_source='custom'
FROM chart_restore_organizations o WHERE o.id=g.organization_id
  AND g.created_at<'2026-07-09T09:01:31.177489Z'::timestamptz;

SELECT action,count(*) FROM public.chart_restoration_audit GROUP BY action;
ROLLBACK;