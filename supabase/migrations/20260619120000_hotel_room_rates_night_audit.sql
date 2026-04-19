-- Hotel: per-room nightly rate, folio night tracking, automated room charges + accounting.
-- Includes journal org trigger fix (explicit organization_id for service/cron posts) and
-- optional p_organization_id on create_journal_entry_atomic for server-side posters.

-- 1) Room rack override (falls back to room_types.base_price in app/RPC)
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS nightly_rate numeric(12,2);

COMMENT ON COLUMN public.rooms.nightly_rate IS
  'Optional override of room type rack rate for this room; when null, room_types.base_price applies.';

-- 2) Billing: tie room auto-charges to a folio night (idempotent per stay + night)
ALTER TABLE public.billing
  ADD COLUMN IF NOT EXISTS stay_night_date date;

ALTER TABLE public.billing
  ADD COLUMN IF NOT EXISTS auto_charge_source text NOT NULL DEFAULT 'manual';

ALTER TABLE public.billing DROP CONSTRAINT IF EXISTS billing_auto_charge_source_check;

ALTER TABLE public.billing
  ADD CONSTRAINT billing_auto_charge_source_check
  CHECK (auto_charge_source IN ('manual', 'checkin', 'night_audit'));

CREATE UNIQUE INDEX IF NOT EXISTS billing_room_stay_night_uq
  ON public.billing (stay_id, stay_night_date)
  WHERE stay_id IS NOT NULL
    AND stay_night_date IS NOT NULL
    AND charge_type = 'room';

COMMENT ON COLUMN public.billing.stay_night_date IS
  'Calendar night charged (property timezone); used to prevent duplicate auto room charges.';
COMMENT ON COLUMN public.billing.auto_charge_source IS
  'manual = staff entry; checkin = first night at check-in; night_audit = scheduled/manual audit.';

-- 3) Property settings for night boundaries
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS hotel_timezone text NOT NULL DEFAULT 'UTC';

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS hotel_night_audit_time time NOT NULL DEFAULT '02:00:00';

COMMENT ON COLUMN public.organizations.hotel_timezone IS
  'IANA timezone for folio-night boundaries (e.g. Africa/Nairobi). Used by night audit RPC.';
COMMENT ON COLUMN public.organizations.hotel_night_audit_time IS
  'Suggested local run time for automated night audit (informational; schedule in Supabase cron).';

-- 4) Journal org trigger: keep explicit organization_id when provided (service role / RPC)
-- Note: do not put SET search_path between LANGUAGE and AS $...$ — some parsers treat the body as SQL,
-- which turns NEW.column into schema "NEW" (error 3F000). Apply search_path via ALTER FUNCTION.
CREATE OR REPLACE FUNCTION public.set_journal_entry_org_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $set_journal_entry_org$
BEGIN
  IF NEW.organization_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.created_by IS NOT NULL THEN
    SELECT organization_id
    INTO NEW.organization_id
    FROM public.staff
    WHERE id = NEW.created_by;
  END IF;

  IF NEW.organization_id IS NULL THEN
    SELECT organization_id
    INTO NEW.organization_id
    FROM public.staff
    WHERE id = auth.uid();
  END IF;

  RETURN NEW;
END;
$set_journal_entry_org$;

ALTER FUNCTION public.set_journal_entry_org_id() SET search_path = public;

-- 5) Replace atomic journal RPC with optional organization_id (7th arg; existing 6-arg calls still work)
DROP FUNCTION IF EXISTS public.create_journal_entry_atomic(date, text, text, uuid, uuid, jsonb);

CREATE OR REPLACE FUNCTION public.create_journal_entry_atomic(
  p_entry_date date,
  p_description text,
  p_reference_type text,
  p_reference_id uuid,
  p_created_by uuid,
  p_lines jsonb,
  p_organization_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $create_journal_entry_atomic$
DECLARE
  v_id uuid;
  v_total_dr numeric(15,2) := 0;
  v_total_cr numeric(15,2) := 0;
  v_line jsonb;
  v_idx int := 0;
  v_gl uuid;
  v_dr numeric(15,2);
  v_cr numeric(15,2);
  v_desc text;
  v_dims jsonb;
BEGIN
  IF p_lines IS NULL OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'At least two journal lines are required';
  END IF;

  IF p_reference_id IS NOT NULL THEN
    SELECT je.id INTO v_id
    FROM public.journal_entries je
    WHERE je.reference_type IS NOT DISTINCT FROM p_reference_type
      AND je.reference_id = p_reference_id;
    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_dr := COALESCE((v_line->>'debit')::numeric, 0);
    v_cr := COALESCE((v_line->>'credit')::numeric, 0);
    IF v_dr < 0 OR v_cr < 0 THEN
      RAISE EXCEPTION 'Debit and credit must be non-negative';
    END IF;
    IF v_dr > 0 AND v_cr > 0 THEN
      RAISE EXCEPTION 'Each line must have either a debit or a credit, not both';
    END IF;
    IF v_dr = 0 AND v_cr = 0 THEN
      RAISE EXCEPTION 'Each line must have a non-zero debit or credit';
    END IF;
    v_total_dr := v_total_dr + v_dr;
    v_total_cr := v_total_cr + v_cr;
  END LOOP;

  IF ABS(v_total_dr - v_total_cr) > 0.01 THEN
    RAISE EXCEPTION 'Debits must equal credits';
  END IF;

  BEGIN
    INSERT INTO public.journal_entries (
      entry_date,
      description,
      reference_type,
      reference_id,
      created_by,
      organization_id
    )
    VALUES (
      p_entry_date,
      p_description,
      p_reference_type,
      p_reference_id,
      p_created_by,
      p_organization_id
    )
    RETURNING id INTO v_id;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT je.id INTO v_id
      FROM public.journal_entries je
      WHERE p_reference_id IS NOT NULL
        AND je.reference_type IS NOT DISTINCT FROM p_reference_type
        AND je.reference_id = p_reference_id;
      IF v_id IS NOT NULL THEN
        RETURN v_id;
      END IF;
      RAISE;
  END;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_gl := (v_line->>'gl_account_id')::uuid;
    v_dr := COALESCE((v_line->>'debit')::numeric, 0);
    v_cr := COALESCE((v_line->>'credit')::numeric, 0);
    v_desc := NULLIF(TRIM(COALESCE(v_line->>'line_description', '')), '');
    v_dims := COALESCE(v_line->'dimensions', '{}'::jsonb);
    IF jsonb_typeof(v_dims) IS DISTINCT FROM 'object' THEN
      v_dims := '{}'::jsonb;
    END IF;
    INSERT INTO public.journal_entry_lines (
      journal_entry_id,
      gl_account_id,
      debit,
      credit,
      line_description,
      sort_order,
      dimensions
    ) VALUES (
      v_id,
      v_gl,
      v_dr,
      v_cr,
      v_desc,
      v_idx,
      v_dims
    );
    v_idx := v_idx + 1;
  END LOOP;

  RETURN v_id;
END;
$create_journal_entry_atomic$;

ALTER FUNCTION public.create_journal_entry_atomic(date, text, text, uuid, uuid, jsonb, uuid) SET search_path = public;

COMMENT ON FUNCTION public.create_journal_entry_atomic(date, text, text, uuid, uuid, jsonb, uuid) IS
  'Atomic journal header + lines; optional per-line dimensions; optional organization_id for cron/service posts. SECURITY DEFINER.';

REVOKE ALL ON FUNCTION public.create_journal_entry_atomic(date, text, text, uuid, uuid, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_journal_entry_atomic(date, text, text, uuid, uuid, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_journal_entry_atomic(date, text, text, uuid, uuid, jsonb, uuid) TO service_role;

-- 6) Post one room night to folio + journal (idempotent on stay_id + stay_night_date)
CREATE OR REPLACE FUNCTION public.post_hotel_room_night_charge(
  p_organization_id uuid,
  p_stay_id uuid,
  p_source text,
  p_created_by uuid DEFAULT NULL,
  p_folio_night_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $post_hotel_room_night_charge$
DECLARE
  v_allowed boolean := false;
  v_stay_found boolean := false;
  v_tz text;
  v_night date;
  st record;
  v_rate numeric(15,2);
  v_room_no text;
  v_rec uuid;
  v_rev uuid;
  v_bid uuid;
  v_jid uuid;
  v_desc text;
BEGIN
  IF p_source IS NULL OR p_source NOT IN ('checkin', 'night_audit') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid source');
  END IF;

  IF auth.role() = 'service_role' THEN
    v_allowed := true;
  ELSE
    v_allowed := EXISTS (
      SELECT 1
      FROM public.staff s
      WHERE s.id = auth.uid()
        AND s.organization_id = p_organization_id
    );
  END IF;

  IF NOT COALESCE(v_allowed, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  v_tz := (
    SELECT COALESCE(hotel_timezone, 'UTC')
    FROM public.organizations
    WHERE id = p_organization_id
  );

  IF v_tz IS NULL OR trim(v_tz) = '' THEN
    v_tz := 'UTC';
  END IF;

  FOR st IN
    SELECT
      s.id,
      s.organization_id,
      s.room_id,
      s.actual_check_in,
      s.actual_check_out,
      s.reservation_id,
      r.check_out_date AS res_check_out
    FROM public.stays s
    LEFT JOIN public.reservations r ON r.id = s.reservation_id
    WHERE s.id = p_stay_id
      AND s.organization_id IS NOT DISTINCT FROM p_organization_id
  LOOP
    v_stay_found := true;
    EXIT;
  END LOOP;

  IF NOT v_stay_found THEN
    RETURN jsonb_build_object('ok', false, 'error', 'stay not found for organization');
  END IF;

  IF p_source = 'checkin' THEN
    IF p_folio_night_date IS NULL THEN
      v_night := (st.actual_check_in AT TIME ZONE v_tz)::date;
    ELSE
      v_night := p_folio_night_date;
    END IF;
  ELSE
    IF p_folio_night_date IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'folio night date required for night_audit');
    END IF;
    v_night := p_folio_night_date;
  END IF;

  -- Occupancy rules for night_audit
  IF p_source = 'night_audit' THEN
    IF (st.actual_check_in AT TIME ZONE v_tz)::date > v_night THEN
      RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'before_stay');
    END IF;
    IF st.actual_check_out IS NOT NULL
      AND (st.actual_check_out AT TIME ZONE v_tz)::date <= v_night THEN
      RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'checked_out');
    END IF;
    IF st.reservation_id IS NOT NULL AND st.res_check_out IS NOT NULL THEN
      IF st.res_check_out <= v_night THEN
        RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'past_reservation');
      END IF;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.billing b
    WHERE b.stay_id = p_stay_id
      AND b.stay_night_date = v_night
      AND b.charge_type = 'room'
  ) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'already_charged', 'stay_night_date', v_night);
  END IF;

  v_rate := (
    SELECT COALESCE(rm.nightly_rate, rt.base_price, 0)::numeric(15,2)
    FROM public.rooms rm
    LEFT JOIN public.room_types rt ON rt.id = rm.room_type_id
    WHERE rm.id = st.room_id
  );
  v_room_no := (
    SELECT rm.room_number
    FROM public.rooms rm
    WHERE rm.id = st.room_id
  );

  IF v_rate IS NULL OR v_rate <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_room_rate', 'stay_night_date', v_night);
  END IF;

  v_rec := (
    SELECT receivable_gl_account_id
    FROM public.journal_gl_settings
    WHERE organization_id = p_organization_id
  );
  v_rev := (
    SELECT revenue_gl_account_id
    FROM public.journal_gl_settings
    WHERE organization_id = p_organization_id
  );

  IF v_rec IS NULL OR v_rev IS NULL THEN
    RETURN jsonb_build_object(
      'ok',
      false,
      'error',
      'Configure journal_gl_settings receivable and revenue for this organization.'
    );
  END IF;

  v_desc := format(
    'Room %s · night %s',
    COALESCE(v_room_no, '?'),
    to_char(v_night, 'YYYY-MM-DD')
  );

  INSERT INTO public.billing (
    organization_id,
    stay_id,
    description,
    amount,
    charge_type,
    charged_at,
    created_by,
    stay_night_date,
    auto_charge_source
  )
  VALUES (
    p_organization_id,
    p_stay_id,
    v_desc,
    v_rate,
    'room',
    now(),
    p_created_by,
    v_night,
    p_source
  )
  RETURNING id INTO v_bid;

  v_jid := public.create_journal_entry_atomic(
    v_night,
    'Room charge: ' || v_desc,
    'room_charge',
    v_bid,
    p_created_by,
    jsonb_build_array(
      jsonb_build_object(
        'gl_account_id', v_rec::text,
        'debit', v_rate,
        'credit', 0,
        'line_description', v_desc
      ),
      jsonb_build_object(
        'gl_account_id', v_rev::text,
        'debit', 0,
        'credit', v_rate,
        'line_description', 'Room revenue'
      )
    ),
    p_organization_id
  );

  RETURN jsonb_build_object(
    'ok', true,
    'skipped', false,
    'billing_id', v_bid,
    'journal_id', v_jid,
    'stay_night_date', v_night,
    'amount', v_rate
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'unique_violation');
END;
$post_hotel_room_night_charge$;

ALTER FUNCTION public.post_hotel_room_night_charge(uuid, uuid, text, uuid, date) SET search_path = public;

REVOKE ALL ON FUNCTION public.post_hotel_room_night_charge(uuid, uuid, text, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_hotel_room_night_charge(uuid, uuid, text, uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_hotel_room_night_charge(uuid, uuid, text, uuid, date) TO service_role;

-- 7) Night audit for one org: charge folio night (default = yesterday in property TZ)
CREATE OR REPLACE FUNCTION public.run_hotel_night_audit_for_org(
  p_organization_id uuid,
  p_folio_night_date date DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $run_hotel_night_audit_for_org$
DECLARE
  v_allowed boolean := false;
  v_tz text;
  v_night date;
  st record;
  v_res jsonb;
  v_posted int := 0;
  v_skipped int := 0;
  v_failed int := 0;
  v_last_err text;
BEGIN
  IF auth.role() = 'service_role' THEN
    v_allowed := true;
  ELSE
    v_allowed := EXISTS (
      SELECT 1
      FROM public.staff s
      WHERE s.id = auth.uid()
        AND s.organization_id = p_organization_id
    );
  END IF;

  IF NOT COALESCE(v_allowed, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  v_tz := (
    SELECT COALESCE(hotel_timezone, 'UTC')
    FROM public.organizations
    WHERE id = p_organization_id
  );

  IF v_tz IS NULL OR trim(v_tz) = '' THEN
    v_tz := 'UTC';
  END IF;

  IF p_folio_night_date IS NULL THEN
    v_night := ((CURRENT_TIMESTAMP AT TIME ZONE v_tz)::date - 1);
  ELSE
    v_night := p_folio_night_date;
  END IF;

  FOR st IN
    SELECT s.id
    FROM public.stays s
    LEFT JOIN public.reservations r ON r.id = s.reservation_id
    WHERE s.organization_id = p_organization_id
      AND (s.actual_check_in AT TIME ZONE v_tz)::date <= v_night
      AND (
        s.actual_check_out IS NULL
        OR (s.actual_check_out AT TIME ZONE v_tz)::date > v_night
      )
      AND (
        s.reservation_id IS NULL
        OR r.check_out_date IS NULL
        OR r.check_out_date > v_night
      )
  LOOP
    v_res := public.post_hotel_room_night_charge(
      p_organization_id,
      st.id,
      'night_audit',
      p_created_by,
      v_night
    );
    IF COALESCE((v_res->>'ok')::boolean, false) THEN
      IF COALESCE((v_res->>'skipped')::boolean, false) THEN
        v_skipped := v_skipped + 1;
      ELSE
        v_posted := v_posted + 1;
      END IF;
    ELSE
      v_failed := v_failed + 1;
      v_last_err := COALESCE(v_res->>'error', v_res::text);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'folio_night_date', v_night,
    'posted', v_posted,
    'skipped', v_skipped,
    'failed', v_failed,
    'last_error', v_last_err
  );
END;
$run_hotel_night_audit_for_org$;

ALTER FUNCTION public.run_hotel_night_audit_for_org(uuid, date, uuid) SET search_path = public;

REVOKE ALL ON FUNCTION public.run_hotel_night_audit_for_org(uuid, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_hotel_night_audit_for_org(uuid, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_hotel_night_audit_for_org(uuid, date, uuid) TO service_role;
