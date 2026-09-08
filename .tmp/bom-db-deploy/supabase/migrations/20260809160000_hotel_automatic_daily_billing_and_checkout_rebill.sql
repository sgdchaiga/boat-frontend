CREATE TABLE IF NOT EXISTS public.hotel_night_audit_runs (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  last_local_run_date date NOT NULL, last_run_at timestamptz NOT NULL DEFAULT now(), result jsonb
);

CREATE OR REPLACE FUNCTION public.run_due_hotel_night_audits() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o record; v_local_date date; v_result jsonb; v_count int:=0;
BEGIN
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  FOR o IN SELECT id,COALESCE(hotel_timezone,'UTC') tz,COALESCE(hotel_night_audit_time,'02:00') audit_time
    FROM organizations WHERE COALESCE(hotel_enable_smart_room_charges,true)
  LOOP
    v_local_date := (now() AT TIME ZONE o.tz)::date;
    IF (now() AT TIME ZONE o.tz)::time >= o.audit_time AND NOT EXISTS(
      SELECT 1 FROM hotel_night_audit_runs r WHERE r.organization_id=o.id AND r.last_local_run_date>=v_local_date
    ) THEN
      v_result := run_hotel_night_audit_for_org(o.id,v_local_date-1,NULL);
      INSERT INTO hotel_night_audit_runs(organization_id,last_local_run_date,last_run_at,result)
      VALUES(o.id,v_local_date,now(),v_result) ON CONFLICT(organization_id) DO UPDATE
      SET last_local_run_date=EXCLUDED.last_local_run_date,last_run_at=now(),result=EXCLUDED.result;
      v_count:=v_count+1;
    END IF;
  END LOOP;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.run_due_hotel_night_audits() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_due_hotel_night_audits() TO service_role;

CREATE OR REPLACE FUNCTION public.set_hotel_night_audit_schedule(p_time time, p_timezone text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM staff WHERE id=auth.uid() AND role IN('admin','manager','super_admin') AND is_active;
  IF v_org IS NULL THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF p_timezone IS NULL OR trim(p_timezone)='' THEN RAISE EXCEPTION 'timezone required'; END IF;
  UPDATE organizations SET hotel_night_audit_time=COALESCE(p_time,'02:00'),hotel_timezone=trim(p_timezone) WHERE id=v_org;
END $$;
GRANT EXECUTE ON FUNCTION public.set_hotel_night_audit_schedule(time,text) TO authenticated;

DO $cron$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname='hotel-night-audit-due-runner';
    PERFORM cron.schedule('hotel-night-audit-due-runner','*/5 * * * *','SELECT public.run_due_hotel_night_audits()');
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Hotel night-audit cron schedule skipped: %',SQLERRM; END $cron$;

CREATE OR REPLACE FUNCTION public.correct_hotel_billing_after_checkout_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE x record;
BEGIN
  IF NEW.actual_check_out IS NULL OR NEW.actual_check_out IS NOT DISTINCT FROM OLD.actual_check_out THEN RETURN NEW; END IF;
  FOR x IN SELECT id FROM billing WHERE stay_id=NEW.id AND charge_type='room'
    AND auto_charge_source IN('checkin','night_audit')
    AND stay_night_date >= (NEW.actual_check_out AT TIME ZONE COALESCE((SELECT hotel_timezone FROM organizations WHERE id=NEW.organization_id),'UTC'))::date
  LOOP
    UPDATE journal_entries SET is_deleted=true,deleted_at=now(),deleted_by=auth.uid()
      WHERE reference_type='room_charge' AND reference_id=x.id AND COALESCE(is_deleted,false)=false;
    DELETE FROM billing WHERE id=x.id;
  END LOOP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_correct_hotel_billing_after_checkout ON stays;
CREATE TRIGGER trg_correct_hotel_billing_after_checkout AFTER UPDATE OF actual_check_out ON stays
FOR EACH ROW EXECUTE FUNCTION correct_hotel_billing_after_checkout_change();

-- Ensure check-in always attempts the first room night even if a client screen
-- forgets to call the posting RPC. The unique folio-night index makes this safe.
CREATE OR REPLACE FUNCTION public.post_first_room_night_on_stay_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result jsonb;
BEGIN
  v_result:=post_hotel_room_night_charge(NEW.organization_id,NEW.id,'checkin',NEW.checked_in_by,NULL);
  IF COALESCE((v_result->>'ok')::boolean,false)=false THEN RAISE EXCEPTION 'First-night room charge failed: %',COALESCE(v_result->>'error','unknown error'); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_post_first_room_night_on_stay ON stays;
CREATE TRIGGER trg_post_first_room_night_on_stay AFTER INSERT ON stays FOR EACH ROW EXECUTE FUNCTION post_first_room_night_on_stay_insert();
