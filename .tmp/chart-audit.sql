BEGIN READ ONLY;
SELECT jsonb_build_object(
 'organizations', (SELECT jsonb_agg(x) FROM (select o.id,o.name,o.business_type,o.created_at,count(g.id)::int as accounts,min(g.created_at) as first_account from public.organizations o left join public.gl_accounts g on g.organization_id=o.id group by o.id order by o.created_at) x),
 'accounts', (SELECT jsonb_agg(g) FROM public.gl_accounts g),
 'functions', (SELECT jsonb_agg(x) FROM (select proname,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (proname like '%chart%' or proname like '%standard_setup%' or proname='create_self_service_organization')) x),
 'auditTables', (SELECT jsonb_agg(table_name) FROM information_schema.tables WHERE table_schema='public' AND table_name like '%audit%')
) AS audit;
COMMIT;
