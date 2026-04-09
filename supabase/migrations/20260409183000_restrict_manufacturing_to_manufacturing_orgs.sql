-- Restrict manufacturing tables to manufacturing business type orgs.
-- Platform admins keep full access for support operations.

DO $pol$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'manufacturing_boms',
    'manufacturing_work_orders',
    'manufacturing_production_entries',
    'manufacturing_costing_entries'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_tenant_all', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
       USING (
         public.is_platform_admin()
         OR (
           public.auth_staff_org_id() IS NOT NULL
           AND organization_id = public.auth_staff_org_id()
           AND EXISTS (
             SELECT 1
             FROM public.organizations o
             WHERE o.id = organization_id
               AND o.business_type = ''manufacturing''
           )
         )
       )
       WITH CHECK (
         public.is_platform_admin()
         OR (
           public.auth_staff_org_id() IS NOT NULL
           AND organization_id = public.auth_staff_org_id()
           AND EXISTS (
             SELECT 1
             FROM public.organizations o
             WHERE o.id = organization_id
               AND o.business_type = ''manufacturing''
           )
         )
       )',
      tbl || '_tenant_all',
      tbl
    );
  END LOOP;
END $pol$;
