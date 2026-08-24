-- The cash-room register predated multi-organization sign-in and only checked
-- staff.organization_id. A user legitimately switched to another active
-- organization therefore could read its rooms but could not save a room-day.
DO $$
DECLARE
  v_definition text;
  v_old text := $old$
  IF NOT public.is_platform_admin() AND NOT EXISTS(
    SELECT 1 FROM public.staff s WHERE s.id=v_actor AND s.organization_id=v_org AND COALESCE(s.is_active,true)
      AND s.role IN ('super_admin','admin','manager','receptionist','housekeeping','accountant','supervisor')
  ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Not authorized to use the cash room register.'; END IF;$old$;
  v_new text := $new$
  IF NOT public.is_platform_admin() AND NOT EXISTS(
    SELECT 1 FROM public.staff s WHERE s.id=v_actor AND s.organization_id=v_org AND COALESCE(s.is_active,true)
      AND s.role IN ('super_admin','admin','manager','receptionist','housekeeping','accountant','supervisor')
  ) AND NOT EXISTS(
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id=v_actor AND om.organization_id=v_org AND om.is_active=true
      AND om.role IN ('super_admin','admin','manager','receptionist','housekeeping','accountant','supervisor')
  ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Not authorized to use the cash room register.'; END IF;$new$;
BEGIN
  SELECT pg_get_functiondef(
    'public.save_cash_room_register_entry(uuid,text,date,numeric,boolean,text)'::regprocedure
  ) INTO v_definition;

  IF position(v_new IN v_definition) > 0 THEN
    RETURN;
  END IF;
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Could not update cash-room register authorization: expected function body was not found.';
  END IF;

  EXECUTE replace(v_definition, v_old, v_new);
END $$;

NOTIFY pgrst, 'reload schema';
