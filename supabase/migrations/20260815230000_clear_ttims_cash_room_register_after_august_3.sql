-- One-time user-requested correction for TTIMMS Hotel.
-- Preserve Cash Room Register entries dated 2026-08-03 and clear entries from
-- 2026-08-04 onward. Archive affected rows before changing production data.
DO $$
DECLARE
  v_org uuid;
  v_tz text;
  v_cutoff constant date := DATE '2026-08-04';
  v_cutoff_at timestamptz;
  v_archive_id uuid;
  v_removed_stays integer;
  v_preserved_stays_closed integer;
  v_removed_bills integer;
  v_refunded_payments integer;
  v_deleted_journals integer;
BEGIN
  SELECT id, COALESCE(NULLIF(hotel_timezone, ''), 'UTC')
    INTO STRICT v_org, v_tz
  FROM public.organizations
  WHERE slug = 'ttims';

  v_cutoff_at := ((v_cutoff::text || ' 00:00:00')::timestamp AT TIME ZONE v_tz);

  CREATE TEMP TABLE target_cash_bills ON COMMIT DROP AS
  SELECT b.id, b.stay_id
  FROM public.billing b
  JOIN public.stays s ON s.id = b.stay_id
  WHERE s.organization_id = v_org
    AND COALESCE(s.billing_mode, 'automatic') = 'cash_register'
    AND b.charge_type = 'room'
    AND b.stay_night_date >= v_cutoff;

  CREATE TEMP TABLE target_cash_payments ON COMMIT DROP AS
  SELECT p.id
  FROM public.payments p
  WHERE p.organization_id = v_org
    AND (p.billing_id IN (SELECT id FROM target_cash_bills)
      OR (p.stay_id IN (SELECT DISTINCT stay_id FROM target_cash_bills)
        AND (p.paid_at AT TIME ZONE v_tz)::date >= v_cutoff));

  CREATE TEMP TABLE removable_cash_stays ON COMMIT DROP AS
  SELECT s.id, s.room_id
  FROM public.stays s
  WHERE s.organization_id = v_org
    AND COALESCE(s.billing_mode, 'automatic') = 'cash_register'
    AND (s.actual_check_in AT TIME ZONE v_tz)::date >= v_cutoff
    AND NOT EXISTS (
      SELECT 1 FROM public.billing b
      WHERE b.stay_id = s.id AND b.charge_type = 'room' AND b.stay_night_date < v_cutoff
    );

  CREATE TEMP TABLE preserved_cash_stays ON COMMIT DROP AS
  SELECT DISTINCT s.id, s.room_id
  FROM public.stays s
  WHERE s.organization_id = v_org
    AND COALESCE(s.billing_mode, 'automatic') = 'cash_register'
    AND (s.actual_check_in AT TIME ZONE v_tz)::date < v_cutoff
    AND (s.actual_check_out IS NULL OR s.actual_check_out > v_cutoff_at);

  CREATE TEMP TABLE target_cash_journals ON COMMIT DROP AS
  SELECT je.id
  FROM public.journal_entries je
  WHERE je.organization_id = v_org
    AND COALESCE(je.is_deleted, false) = false
    AND ((je.reference_type = 'room_charge' AND je.reference_id IN (SELECT id FROM target_cash_bills))
      OR (je.reference_type = 'payment' AND je.reference_id IN (SELECT id FROM target_cash_payments)));

  SELECT count(*) INTO v_removed_stays FROM removable_cash_stays;
  SELECT count(*) INTO v_preserved_stays_closed FROM preserved_cash_stays;
  SELECT count(*) INTO v_removed_bills FROM target_cash_bills;
  SELECT count(*) INTO v_refunded_payments FROM target_cash_payments;
  SELECT count(*) INTO v_deleted_journals FROM target_cash_journals;

  INSERT INTO public.hotel_stay_reversal_archives(operation_key, organization_id, reason, snapshot)
  VALUES (
    'ttims-cash-room-register-from-2026-08-04',
    v_org,
    'User requested Cash Room Register reset from 4 August 2026 while preserving 3 August',
    jsonb_build_object(
      'cutoff_date', v_cutoff,
      'stays_removed', (SELECT COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb) FROM public.stays s WHERE s.id IN (SELECT id FROM removable_cash_stays)),
      'stays_closed', (SELECT COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb) FROM public.stays s WHERE s.id IN (SELECT id FROM preserved_cash_stays)),
      'billing', (SELECT COALESCE(jsonb_agg(to_jsonb(b)), '[]'::jsonb) FROM public.billing b WHERE b.id IN (SELECT id FROM target_cash_bills)),
      'payments', (SELECT COALESCE(jsonb_agg(to_jsonb(p)), '[]'::jsonb) FROM public.payments p WHERE p.id IN (SELECT id FROM target_cash_payments)),
      'journal_entries', (SELECT COALESCE(jsonb_agg(to_jsonb(je)), '[]'::jsonb) FROM public.journal_entries je WHERE je.id IN (SELECT id FROM target_cash_journals)),
      'journal_entry_lines', (SELECT COALESCE(jsonb_agg(to_jsonb(jel)), '[]'::jsonb) FROM public.journal_entry_lines jel WHERE jel.journal_entry_id IN (SELECT id FROM target_cash_journals)),
      'archived_at', now()
    )
  )
  RETURNING id INTO v_archive_id;

  UPDATE public.journal_entries
  SET is_deleted = true, deleted_at = now(), deleted_by = NULL
  WHERE id IN (SELECT id FROM target_cash_journals);

  UPDATE public.payments
  SET payment_status = 'refunded'
  WHERE id IN (SELECT id FROM target_cash_payments);

  DELETE FROM public.billing
  WHERE id IN (SELECT id FROM target_cash_bills);

  DELETE FROM public.stays
  WHERE id IN (SELECT id FROM removable_cash_stays);

  UPDATE public.stays
  SET actual_check_out = v_cutoff_at, checked_out_by = NULL
  WHERE id IN (SELECT id FROM preserved_cash_stays);

  UPDATE public.rooms r
  SET status = 'available'
  WHERE r.organization_id = v_org
    AND r.id IN (
      SELECT room_id FROM removable_cash_stays
      UNION
      SELECT room_id FROM preserved_cash_stays
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.stays s
      WHERE s.room_id = r.id AND s.actual_check_out IS NULL
    );

  RAISE NOTICE 'Cash Room Register reset archive=% removed_stays=% closed_preserved_stays=% removed_bills=% refunded_payments=% deleted_journals=%',
    v_archive_id, v_removed_stays, v_preserved_stays_closed, v_removed_bills, v_refunded_payments, v_deleted_journals;
END $$;
