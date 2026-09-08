BEGIN READ ONLY;
SELECT jsonb_build_object(
 'audit_columns', (SELECT jsonb_agg(x) FROM (SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='audit_logs') x),
 'audit_gl', (SELECT jsonb_agg(x) FROM (SELECT to_jsonb(a) AS entry FROM public.audit_logs a WHERE to_jsonb(a)::text LIKE '%gl_accounts%' LIMIT 10) x),
 'references', (SELECT jsonb_agg(x) FROM (SELECT conrelid::regclass::text AS table_name,a.attname AS column_name FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey) WHERE c.contype='f' AND c.confrelid='public.gl_accounts'::regclass) x),
 'migrations', (SELECT jsonb_agg(version) FROM supabase_migrations.schema_migrations)
) AS audit;
COMMIT;
