BEGIN READ ONLY;
SELECT jsonb_build_object(
  'summary',(SELECT jsonb_agg(x) FROM (
    SELECT o.name,a.action,count(*)::integer AS accounts,
      count(*) FILTER(WHERE a.action='deactivated_unused_template' AND (a.original_account->>'is_active')::boolean)::integer AS newly_deactivated
    FROM public.chart_restoration_audit a JOIN public.organizations o ON o.id=a.organization_id GROUP BY o.name,a.action ORDER BY o.name,a.action
  ) x),
  'audit',(SELECT jsonb_agg(a) FROM public.chart_restoration_audit a),
  'source_counts',(SELECT jsonb_agg(x) FROM (SELECT chart_of_accounts_source,count(*) FROM public.organizations GROUP BY chart_of_accounts_source) x),
  'incorrectly_active',(SELECT count(*) FROM public.chart_restoration_audit a JOIN public.gl_accounts g ON g.id=a.account_id WHERE a.action='deactivated_unused_template' AND g.is_active),
  'referenced_changed',(SELECT count(*) FROM public.chart_restoration_audit a JOIN public.gl_accounts g ON g.id=a.account_id WHERE a.action='retained_referenced_template' AND to_jsonb(g) IS DISTINCT FROM a.original_account),
  'versions',(SELECT jsonb_agg(version) FROM supabase_migrations.schema_migrations WHERE version IN ('20260907120000','20260907121000'))
) AS verification;
COMMIT;
