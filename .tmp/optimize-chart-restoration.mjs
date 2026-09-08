import fs from 'node:fs';
const path='supabase/migrations/20260907121000_restore_original_organization_charts.sql';
let s=fs.readFileSync(path,'utf8');const start=s.indexOf('DO $$'); const end=s.indexOf('UPDATE public.gl_accounts g SET',start);
s=s.slice(0,start)+`DO $$
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
`+s.slice(end);fs.writeFileSync(path,s);
