-- Final scoped cleanup for legacy orphan Cash Room Register stays reported on
-- rooms 3 and 6. Preserve all 3 August billing and refuse to touch any stay
-- with a room charge dated 4 August 2026 or later.
DO $$
DECLARE
  v_org uuid;
  v_tz text;
  v_cutoff constant date := DATE '2026-08-04';
  v_cutoff_at timestamptz;
  v_archive_id uuid;
  v_count integer;
BEGIN
  SELECT id, COALESCE(NULLIF(hotel_timezone, ''), 'UTC')
    INTO STRICT v_org, v_tz
  FROM public.organizations
  WHERE slug = 'ttims';

  v_cutoff_at := ((v_cutoff::text || ' 00:00:00')::timestamp AT TIME ZONE v_tz);

  CREATE TEMP TABLE target_orphan_cash_stays ON COMMIT DROP AS
  SELECT s.id, s.room_id
  FROM public.stays s
  JOIN public.rooms r ON r.id = s.room_id
  WHERE s.organization_id = v_org
    AND COALESCE(s.billing_mode, 'automatic') = 'cash_register'
    AND ltrim(r.room_number, '0') IN ('3', '6')
    AND (s.actual_check_out IS NULL OR s.actual_check_out > v_cutoff_at)
    AND NOT EXISTS (
      SELECT 1 FROM public.billing b
      WHERE b.stay_id = s.id
        AND b.charge_type = 'room'
        AND b.stay_night_date >= v_cutoff
    );

  SELECT count(*) INTO v_count FROM target_orphan_cash_stays;
  IF v_count = 0 THEN
    RAISE NOTICE 'No orphan Cash Room Register stays found for TTIMMS rooms 3 and 6.';
    RETURN;
  END IF;

  INSERT INTO public.hotel_stay_reversal_archives(operation_key, organization_id, reason, snapshot)
  VALUES (
    'ttims-close-rooms-3-6-orphan-cash-stays',
    v_org,
    'Close reported legacy Cash Room Register occupancy after preserving 3 August',
    jsonb_build_object(
      'stays', (SELECT COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb) FROM public.stays s WHERE s.id IN (SELECT id FROM target_orphan_cash_stays)),
      'billing', (SELECT COALESCE(jsonb_agg(to_jsonb(b)), '[]'::jsonb) FROM public.billing b WHERE b.stay_id IN (SELECT id FROM target_orphan_cash_stays)),
      'payments', (SELECT COALESCE(jsonb_agg(to_jsonb(p)), '[]'::jsonb) FROM public.payments p WHERE p.stay_id IN (SELECT id FROM target_orphan_cash_stays)),
      'archived_at', now()
    )
  )
  RETURNING id INTO v_archive_id;

  UPDATE public.stays
  SET actual_check_out = v_cutoff_at, checked_out_by = NULL
  WHERE id IN (SELECT id FROM target_orphan_cash_stays);

  UPDATE public.rooms r
  SET status = 'available'
  WHERE r.id IN (SELECT room_id FROM target_orphan_cash_stays)
    AND NOT EXISTS (
      SELECT 1 FROM public.stays s
      WHERE s.room_id = r.id AND s.actual_check_out IS NULL
    );

  RAISE NOTICE 'Closed % orphan Cash Room Register stays for rooms 3 and 6; archive=%', v_count, v_archive_id;
END $$;
