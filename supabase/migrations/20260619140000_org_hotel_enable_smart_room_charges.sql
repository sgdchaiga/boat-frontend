-- Platform-controlled switch: automated hotel room charges (check-in first night + night audit).
-- When false, staff post room revenue manually on Billing; RPCs no-op with skipped reason.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS hotel_enable_smart_room_charges boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.organizations.hotel_enable_smart_room_charges IS
  'When false, automated room posting (check-in + run_hotel_night_audit_for_org) is disabled; charges are manual. Platform admins only can change.';

-- post_hotel_room_night_charge: skip when disabled
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
  v_hotel_smart_charges_enabled boolean := true;
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

  IF NOT EXISTS (
    SELECT 1 FROM public.organizations o WHERE o.id = p_organization_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'organization_not_found');
  END IF;

  v_hotel_smart_charges_enabled := (
    SELECT COALESCE(o.hotel_enable_smart_room_charges, true)
    FROM public.organizations o
    WHERE o.id = p_organization_id
  );

  IF NOT COALESCE(v_hotel_smart_charges_enabled, true) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'smart_room_charges_disabled'
    );
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

-- run_hotel_night_audit_for_org: no-op when disabled
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
  v_hotel_smart_charges_enabled boolean := true;
  v_tz text;
  v_night date;
  st record;
  v_res jsonb;
  v_posted int := 0;
  v_skipped int := 0;
  v_failed int := 0;
  v_last_err text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.organizations o WHERE o.id = p_organization_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'organization_not_found');
  END IF;

  v_hotel_smart_charges_enabled := (
    SELECT COALESCE(o.hotel_enable_smart_room_charges, true)
    FROM public.organizations o
    WHERE o.id = p_organization_id
  );

  IF NOT COALESCE(v_hotel_smart_charges_enabled, true) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'folio_night_date', p_folio_night_date,
      'posted', 0,
      'skipped', 0,
      'failed', 0,
      'last_error', null,
      'reason', 'smart_room_charges_disabled'
    );
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
