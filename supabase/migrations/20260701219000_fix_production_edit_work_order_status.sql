-- Production-entry edits reverse the old work-order quantity before reposting it.
-- A zero completed quantity is a Planned work order; Draft is a BOM status and
-- violates manufacturing_work_orders_status_check.
DO $migration$
DECLARE
  function_definition text;
BEGIN
  SELECT pg_get_functiondef(proc.oid)
  INTO function_definition
  FROM pg_proc proc
  JOIN pg_namespace namespace ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'public'
    AND proc.proname = 'post_manufacturing_bom_consumption'
    AND pg_get_function_identity_arguments(proc.oid) = '';

  IF function_definition IS NULL THEN
    RAISE EXCEPTION 'public.post_manufacturing_bom_consumption() was not found';
  END IF;

  IF position('ELSE ''Draft''' IN function_definition) > 0 THEN
    EXECUTE replace(function_definition, 'ELSE ''Draft''', 'ELSE ''Planned''');
  ELSIF position('ELSE ''Planned''' IN function_definition) = 0 THEN
    RAISE EXCEPTION 'The work-order reset status could not be identified in post_manufacturing_bom_consumption()';
  END IF;
END;
$migration$;
