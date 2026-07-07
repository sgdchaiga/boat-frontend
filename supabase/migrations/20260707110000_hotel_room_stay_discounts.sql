-- Per-stay room discounts.
-- Staff should discount the guest/stay charge instead of changing the configured
-- room rack rate (`rooms.nightly_rate` / `room_types.base_price`).

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS room_discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS room_discount_reason text;

ALTER TABLE public.stays
  ADD COLUMN IF NOT EXISTS room_discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS room_discount_reason text;

ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_room_discount_amount_nonnegative;
ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_room_discount_amount_nonnegative CHECK (room_discount_amount >= 0);

ALTER TABLE public.stays
  DROP CONSTRAINT IF EXISTS stays_room_discount_amount_nonnegative;
ALTER TABLE public.stays
  ADD CONSTRAINT stays_room_discount_amount_nonnegative CHECK (room_discount_amount >= 0);

COMMENT ON COLUMN public.reservations.room_discount_amount IS
  'Per-night room discount for this reservation. Does not alter configured room rack rate.';
COMMENT ON COLUMN public.stays.room_discount_amount IS
  'Per-night room discount for this stay. Automatic room-night charges subtract this from the rack rate.';

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
  v_tz text;
  v_night date;
  st record;
  v_rack_rate numeric(15,2);
  v_discount numeric(15,2) := 0;
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
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'smart_room_charges_disabled');
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
      COALESCE(s.room_discount_amount, 0)::numeric(15,2) AS room_discount_amount,
      NULLIF(trim(COALESCE(s.room_discount_reason, '')), '') AS room_discount_reason,
      r.check_out_date AS res_check_out
    FROM public.stays s
    LEFT JOIN public.reservations r ON r.id = s.reservation_id
    WHERE s.id = p_stay_id
      AND s.organization_id IS NOT DISTINCT FROM p_organization_id
  LOOP
    EXIT;
  END LOOP;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'stay not found for organization');
  END IF;

  IF p_source = 'checkin' THEN
    v_night := COALESCE(p_folio_night_date, (st.actual_check_in AT TIME ZONE v_tz)::date);
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
    IF st.reservation_id IS NOT NULL AND st.res_check_out IS NOT NULL AND st.res_check_out <= v_night THEN
      RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'past_reservation');
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

  v_rack_rate := (
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

  IF v_rack_rate IS NULL OR v_rack_rate <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_room_rate', 'stay_night_date', v_night);
  END IF;

  v_discount := LEAST(GREATEST(COALESCE(st.room_discount_amount, 0), 0), v_rack_rate);
  v_rate := GREATEST(v_rack_rate - v_discount, 0);

  IF v_rate <= 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'fully_discounted',
      'stay_night_date', v_night,
      'rack_rate', v_rack_rate,
      'discount', v_discount,
      'amount', 0
    );
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
    RETURN jsonb_build_object('ok', false, 'error', 'Configure journal_gl_settings receivable and revenue for this organization.');
  END IF;

  v_desc := format('Room %s - night %s', COALESCE(v_room_no, '?'), to_char(v_night, 'YYYY-MM-DD'));
  IF v_discount > 0 THEN
    v_desc := v_desc || format(' - discount %s from rack %s', v_discount, v_rack_rate);
    IF st.room_discount_reason IS NOT NULL THEN
      v_desc := v_desc || format(' (%s)', st.room_discount_reason);
    END IF;
  END IF;

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
      jsonb_build_object('gl_account_id', v_rec::text, 'debit', v_rate, 'credit', 0, 'line_description', v_desc),
      jsonb_build_object('gl_account_id', v_rev::text, 'debit', 0, 'credit', v_rate, 'line_description', 'Room revenue')
    ),
    p_organization_id
  );

  RETURN jsonb_build_object(
    'ok', true,
    'skipped', false,
    'billing_id', v_bid,
    'journal_id', v_jid,
    'stay_night_date', v_night,
    'rack_rate', v_rack_rate,
    'discount', v_discount,
    'amount', v_rate
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'unique_violation');
END;
$post_hotel_room_night_charge$;

ALTER FUNCTION public.post_hotel_room_night_charge(uuid, uuid, text, uuid, date) SET search_path = public;
