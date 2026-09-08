import fs from 'node:fs';
const a=JSON.parse(fs.readFileSync('.tmp/chart-audit-api.json','utf8')).rows[0].audit;
const c=JSON.parse(fs.readFileSync('.tmp/chart-restoration-candidates.json','utf8'));
const ids=[...new Set(c.map(g=>g.organization_id))];
const lines=ids.map(id=>`  ('${id}'::uuid)`).join(',\n');
const sql=`-- Audited 2026-09-07: these 12 organizations had established charts before
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
INSERT INTO chart_restore_organizations VALUES\n${lines};

-- Snapshot the complete account before making reversible visibility changes.
INSERT INTO public.chart_restoration_audit(account_id,organization_id,original_account,action)
SELECT g.id,g.organization_id,to_jsonb(g),'review'
FROM public.gl_accounts g JOIN chart_restore_organizations o ON o.id=g.organization_id
WHERE g.created_at='2026-07-09T09:01:31.177489Z'::timestamptz
ON CONFLICT(account_id) DO NOTHING;

DO $$
DECLARE ref record; use_count bigint; account_row record; refs jsonb;
BEGIN
  FOR account_row IN SELECT * FROM public.chart_restoration_audit WHERE action='review' LOOP
    refs := '[]'::jsonb;
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
      EXECUTE format('SELECT count(*) FROM %s WHERE %I::text = $1',ref.table_name::regclass,ref.column_name)
        INTO use_count USING account_row.account_id::text;
      IF use_count>0 THEN refs:=refs||jsonb_build_array(jsonb_build_object('table',ref.table_name,'column',ref.column_name,'count',use_count)); END IF;
    END LOOP;
    UPDATE public.chart_restoration_audit SET reference_details=refs,
      action=CASE WHEN jsonb_array_length(refs)=0 THEN 'deactivated_unused_template' ELSE 'retained_referenced_template' END
    WHERE account_id=account_row.account_id;
  END LOOP;
END;
$$;
UPDATE public.gl_accounts g SET is_active=false,account_source='template'
FROM public.chart_restoration_audit a WHERE a.account_id=g.id AND a.action='deactivated_unused_template';
-- Original charts stay authoritative in account pickers even when a name resembles another industry.
UPDATE public.gl_accounts g SET account_source='custom'
FROM chart_restore_organizations o WHERE o.id=g.organization_id
  AND g.created_at<'2026-07-09T09:01:31.177489Z'::timestamptz;
`;
fs.writeFileSync('supabase/migrations/20260907121000_restore_original_organization_charts.sql',sql);
