BEGIN READ ONLY;
SELECT jsonb_build_object(
 'functions',(SELECT jsonb_agg(jsonb_build_object('name',p.proname,'body',p.prosrc,'security_definer',p.prosecdef)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('validate_school_rental_property','charge_school_rental_month','protect_school_rental_invoice')),
 'columns',(SELECT jsonb_agg(column_name) FROM information_schema.columns WHERE table_schema='public' AND table_name='retail_invoices' AND column_name IN ('rental_property_id','rental_month')),
 'constraints',(SELECT jsonb_agg(pg_get_constraintdef(oid)) FROM pg_constraint WHERE conrelid='public.school_rental_properties'::regclass OR conname='rental_invoice_month_check'),
 'triggers',(SELECT jsonb_agg(tgname) FROM pg_trigger WHERE tgname IN ('school_rental_property_validate','school_rental_invoice_protect')),
 'index',to_regclass('public.school_rental_invoice_month_unique')::text,
 'policies',(SELECT jsonb_agg(policyname) FROM pg_policies WHERE tablename='school_rental_properties')
) AS verification;
COMMIT;
