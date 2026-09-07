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
