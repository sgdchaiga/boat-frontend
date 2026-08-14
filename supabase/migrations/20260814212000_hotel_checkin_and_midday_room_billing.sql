-- Guarantee room billing at check-in and once per occupied calendar day at
-- local midday. Existing unique folio-night protection keeps every operation
-- idempotent, including retries and the historical repair at the end.

ALTER TABLE public.organizations
  ALTER COLUMN hotel_night_audit_time SET DEFAULT '12:00:00';

UPDATE public.organizations
SET hotel_enable_smart_room_charges=true,
    hotel_night_audit_time='12:00:00'
WHERE business_type IN ('hotel','mixed');

CREATE OR REPLACE FUNCTION public.run_hotel_midday_billing_for_org(
  p_organization_id uuid,
  p_local_date date,
  p_created_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE st record; v_result jsonb; v_posted integer:=0; v_skipped integer:=0; v_failed integer:=0; v_error text;
BEGIN
  IF auth.role()<>'service_role' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Midday room billing requires the service role.';
  END IF;
  FOR st IN
    SELECT s.id
    FROM public.stays s
    WHERE s.organization_id=p_organization_id
      AND s.actual_check_out IS NULL
      AND (s.actual_check_in AT TIME ZONE COALESCE(NULLIF((SELECT hotel_timezone FROM public.organizations WHERE id=p_organization_id),''),'UTC'))::date<=p_local_date
  LOOP
    -- Explicit folio date plus checkin mode means actual occupancy is
    -- authoritative; a reservation's planned checkout cannot suppress billing.
    v_result:=public.post_hotel_room_night_charge(p_organization_id,st.id,'checkin',p_created_by,p_local_date);
    IF COALESCE((v_result->>'ok')::boolean,false) THEN
      IF COALESCE((v_result->>'skipped')::boolean,false) THEN v_skipped:=v_skipped+1; ELSE v_posted:=v_posted+1; END IF;
    ELSE
      v_failed:=v_failed+1; v_error:=COALESCE(v_result->>'error',v_result::text);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok',v_failed=0,'folio_night_date',p_local_date,'posted',v_posted,'skipped',v_skipped,'failed',v_failed,'last_error',v_error);
END $$;
REVOKE ALL ON FUNCTION public.run_hotel_midday_billing_for_org(uuid,date,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_hotel_midday_billing_for_org(uuid,date,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.run_due_hotel_night_audits() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o record; v_local_date date; v_result jsonb; v_count integer:=0;
BEGIN
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  FOR o IN
    SELECT id,COALESCE(NULLIF(hotel_timezone,''),'UTC') tz,
      COALESCE(hotel_night_audit_time,'12:00:00') audit_time
    FROM public.organizations
    WHERE public.organization_is_hotel_enabled(id)
  LOOP
    v_local_date := (now() AT TIME ZONE o.tz)::date;
    IF (now() AT TIME ZONE o.tz)::time >= o.audit_time
      AND NOT EXISTS(
        SELECT 1 FROM public.hotel_night_audit_runs r
        WHERE r.organization_id=o.id AND r.last_local_run_date>=v_local_date
      )
    THEN
      -- At midday charge today's occupied room day. Check-out correction removes
      -- this charge if a same-day checkout is subsequently recorded.
      v_result := public.run_hotel_midday_billing_for_org(o.id,v_local_date,NULL);
      INSERT INTO public.hotel_night_audit_runs(organization_id,last_local_run_date,last_run_at,result)
      VALUES(o.id,v_local_date,now(),v_result)
      ON CONFLICT(organization_id) DO UPDATE SET
        last_local_run_date=EXCLUDED.last_local_run_date,last_run_at=now(),result=EXCLUDED.result;
      v_count:=v_count+1;
    END IF;
  END LOOP;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.run_due_hotel_night_audits() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_due_hotel_night_audits() TO service_role;

-- A stay insert is the authoritative check-in event. Fail the transaction when
-- the first bill cannot be created, preventing an occupied but unbilled room.
CREATE OR REPLACE FUNCTION public.post_first_room_night_on_stay_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result jsonb;
BEGIN
  v_result:=public.post_hotel_room_night_charge(
    NEW.organization_id,NEW.id,'checkin',NEW.checked_in_by,
    (NEW.actual_check_in AT TIME ZONE COALESCE(NULLIF((SELECT hotel_timezone FROM public.organizations WHERE id=NEW.organization_id),''),'UTC'))::date
  );
  IF COALESCE((v_result->>'ok')::boolean,false)=false
    OR COALESCE((v_result->>'skipped')::boolean,false)
       AND COALESCE(v_result->>'reason','') NOT IN ('already_charged','unique_violation')
  THEN
    RAISE EXCEPTION 'First-night room charge failed: %',COALESCE(v_result->>'error',v_result->>'reason','unknown error');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_post_first_room_night_on_stay ON public.stays;
CREATE TRIGGER trg_post_first_room_night_on_stay
AFTER INSERT ON public.stays FOR EACH ROW
EXECUTE FUNCTION public.post_first_room_night_on_stay_insert();

-- Allow today's noon cycle even if the former 02:00 runner already marked the
-- organization as processed for today.
UPDATE public.hotel_night_audit_runs
SET last_local_run_date=last_local_run_date-1
WHERE organization_id IN (
  SELECT id FROM public.organizations WHERE business_type IN ('hotel','mixed')
);

-- Repair missing room bills for every historical occupied calendar day. The
-- posting function also creates the matching journal and skips existing dates.
DO $repair$
DECLARE st record; v_day date; v_first date; v_last date; v_result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  FOR st IN
    SELECT s.id,s.organization_id,s.actual_check_in,s.actual_check_out,s.checked_in_by,
      COALESCE(NULLIF(o.hotel_timezone,''),'UTC') tz
    FROM public.stays s
    JOIN public.organizations o ON o.id=s.organization_id
    WHERE o.business_type IN ('hotel','mixed')
  LOOP
    v_first := (st.actual_check_in AT TIME ZONE st.tz)::date;
    v_last := CASE WHEN st.actual_check_out IS NULL
      THEN (now() AT TIME ZONE st.tz)::date
      ELSE (st.actual_check_out AT TIME ZONE st.tz)::date-1 END;
    IF v_last < v_first THEN v_last:=v_first; END IF;
    FOR v_day IN SELECT generate_series(v_first,v_last,'1 day'::interval)::date LOOP
      v_result:=public.post_hotel_room_night_charge(
        st.organization_id,st.id,'checkin',st.checked_in_by,v_day
      );
      IF COALESCE((v_result->>'ok')::boolean,false)=false THEN
        RAISE WARNING 'Could not repair room bill for stay %, date %: %',st.id,v_day,v_result;
      END IF;
    END LOOP;
  END LOOP;
END $repair$;

DO $cron$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname='hotel-night-audit-due-runner';
    PERFORM cron.schedule('hotel-night-audit-due-runner','*/5 * * * *','SELECT public.run_due_hotel_night_audits()');
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Hotel midday billing cron schedule skipped: %',SQLERRM; END $cron$;
