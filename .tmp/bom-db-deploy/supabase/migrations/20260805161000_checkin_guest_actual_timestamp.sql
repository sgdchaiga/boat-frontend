-- Align the legacy check-in RPC with the current stays column names.
DO $$
DECLARE
  v_oid oid;
  v_definition text;
BEGIN
  FOR v_oid IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'checkin_guest'
  LOOP
    v_definition := pg_get_functiondef(v_oid);
    v_definition := regexp_replace(
      v_definition,
      E'(\\n\\s*)check_in_time(\\s*,)',
      E'\\1actual_check_in\\2',
      'i'
    );
    EXECUTE v_definition;
  END LOOP;
END $$;
