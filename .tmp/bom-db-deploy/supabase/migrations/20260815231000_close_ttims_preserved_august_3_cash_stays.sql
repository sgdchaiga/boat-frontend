-- Close legacy Cash Room Register stays whose saved room-day is 3 August but
-- whose stay timestamp was created later. Preserve all 3 August accounting.
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

  CREATE TEMP TABLE target_preserved_cash_stays ON COMMIT DROP AS
  SELECT DISTINCT s.id, s.room_id
  FROM public.stays s
  JOIN public.billing b ON b.stay_id = s.id
  WHERE s.organization_id = v_org
    AND COALESCE(s.billing_mode, 'automatic') = 'cash_register'
    AND b.charge_type = 'room'
    AND b.stay_night_date = DATE '2026-08-03'
    AND (s.actual_check_out IS NULL OR s.actual_check_out > v_cutoff_at)
    AND NOT EXISTS (
      SELECT 1
      FROM public.billing later_bill
      WHERE later_bill.stay_id = s.id
        AND later_bill.charge_type = 'room'
        AND later_bill.stay_night_date >= v_cutoff
    );

  SELECT count(*) INTO v_count FROM target_preserved_cash_stays;
  IF v_count = 0 THEN
    RAISE NOTICE 'No lingering preserved 3 August Cash Room Register stays found.';
    RETURN;
  END IF;

  INSERT INTO public.hotel_stay_reversal_archives(operation_key, organization_id, reason, snapshot)
  VALUES (
    'ttims-close-preserved-2026-08-03-cash-stays',
    v_org,
    'Close legacy Cash Room Register stay timestamps while preserving 3 August room-days',
    jsonb_build_object(
      'stays', (SELECT COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb) FROM public.stays s WHERE s.id IN (SELECT id FROM target_preserved_cash_stays)),
      'billing', (SELECT COALESCE(jsonb_agg(to_jsonb(b)), '[]'::jsonb) FROM public.billing b WHERE b.stay_id IN (SELECT id FROM target_preserved_cash_stays)),
      'archived_at', now()
    )
  )
  RETURNING id INTO v_archive_id;

  UPDATE public.stays
  SET actual_check_out = v_cutoff_at, checked_out_by = NULL
  WHERE id IN (SELECT id FROM target_preserved_cash_stays);

  UPDATE public.rooms r
  SET status = 'available'
  WHERE r.id IN (SELECT room_id FROM target_preserved_cash_stays)
    AND NOT EXISTS (
      SELECT 1 FROM public.stays s
      WHERE s.room_id = r.id AND s.actual_check_out IS NULL
    );

  RAISE NOTICE 'Closed % preserved 3 August Cash Room Register stays; archive=%', v_count, v_archive_id;
END $$;
