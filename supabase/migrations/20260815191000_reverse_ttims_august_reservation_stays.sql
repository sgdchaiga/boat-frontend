-- Confirmed one-time correction for TTIMMS Hotel. Preserve a complete snapshot
-- before removing August reservation-workflow stays so they can be re-entered
-- through the Cash Room Register.
CREATE TABLE IF NOT EXISTS public.hotel_stay_reversal_archives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_key text NOT NULL UNIQUE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  reason text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hotel_stay_reversal_archives ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hotel_stay_reversal_archives FROM PUBLIC, anon, authenticated;

DO $$
DECLARE v_org uuid; v_archive_id uuid; v_stay_count int; v_reservation_count int;
BEGIN
  SELECT id INTO STRICT v_org FROM public.organizations WHERE slug='ttims';

  CREATE TEMP TABLE target_august_stays ON COMMIT DROP AS
  SELECT s.id,s.reservation_id,s.room_id
  FROM public.stays s
  WHERE s.organization_id=v_org
    AND s.reservation_id IS NOT NULL
    AND (s.actual_check_in AT TIME ZONE COALESCE((SELECT hotel_timezone FROM public.organizations WHERE id=v_org),'UTC'))::date
        BETWEEN DATE '2026-08-01' AND DATE '2026-08-31';

  SELECT count(*),count(DISTINCT reservation_id) INTO v_stay_count,v_reservation_count FROM target_august_stays;
  IF v_stay_count<>7 OR v_reservation_count<>7 THEN
    RAISE EXCEPTION 'Safety check failed: expected 7 stays and 7 reservations, found % stays and % reservations.',v_stay_count,v_reservation_count;
  END IF;

  CREATE TEMP TABLE target_august_bills ON COMMIT DROP AS
  SELECT b.id FROM public.billing b WHERE b.stay_id IN(SELECT id FROM target_august_stays);
  CREATE TEMP TABLE target_august_payments ON COMMIT DROP AS
  SELECT p.id FROM public.payments p WHERE p.stay_id IN(SELECT id FROM target_august_stays);
  CREATE TEMP TABLE target_august_journals ON COMMIT DROP AS
  SELECT je.id FROM public.journal_entries je
  WHERE je.organization_id=v_org AND COALESCE(je.is_deleted,false)=false
    AND ((je.reference_type='room_charge' AND je.reference_id IN(SELECT id FROM target_august_bills))
      OR (je.reference_type='payment' AND je.reference_id IN(SELECT id FROM target_august_payments)));

  IF (SELECT count(*) FROM target_august_bills)<>9 OR (SELECT count(*) FROM target_august_journals)<>9
     OR (SELECT count(*) FROM target_august_payments)<>0 THEN
    RAISE EXCEPTION 'Safety check failed: linked records changed after confirmation.';
  END IF;

  INSERT INTO public.hotel_stay_reversal_archives(operation_key,organization_id,reason,snapshot)
  VALUES(
    'ttims-2026-08-reservation-stays',v_org,
    'User requested re-entry through Cash Room Register',
    jsonb_build_object(
      'organization',(SELECT to_jsonb(o) FROM public.organizations o WHERE o.id=v_org),
      'stays',(SELECT COALESCE(jsonb_agg(to_jsonb(s)),'[]'::jsonb) FROM public.stays s WHERE s.id IN(SELECT id FROM target_august_stays)),
      'reservations',(SELECT COALESCE(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM public.reservations r WHERE r.id IN(SELECT reservation_id FROM target_august_stays)),
      'billing',(SELECT COALESCE(jsonb_agg(to_jsonb(b)),'[]'::jsonb) FROM public.billing b WHERE b.id IN(SELECT id FROM target_august_bills)),
      'payments',(SELECT COALESCE(jsonb_agg(to_jsonb(p)),'[]'::jsonb) FROM public.payments p WHERE p.id IN(SELECT id FROM target_august_payments)),
      'journal_entries',(SELECT COALESCE(jsonb_agg(to_jsonb(je)),'[]'::jsonb) FROM public.journal_entries je WHERE je.id IN(SELECT id FROM target_august_journals)),
      'journal_entry_lines',(SELECT COALESCE(jsonb_agg(to_jsonb(jel)),'[]'::jsonb) FROM public.journal_entry_lines jel WHERE jel.journal_entry_id IN(SELECT id FROM target_august_journals)),
      'archived_at',now()
    )
  ) RETURNING id INTO v_archive_id;

  UPDATE public.journal_entries
  SET is_deleted=true,deleted_at=now(),deleted_by=NULL
  WHERE id IN(SELECT id FROM target_august_journals);

  DELETE FROM public.stays WHERE id IN(SELECT id FROM target_august_stays);
  DELETE FROM public.reservations WHERE id IN(SELECT reservation_id FROM target_august_stays);

  UPDATE public.rooms r SET status='available'
  WHERE r.id IN(SELECT room_id FROM target_august_stays)
    AND NOT EXISTS(SELECT 1 FROM public.stays s WHERE s.room_id=r.id AND s.actual_check_out IS NULL);

  RAISE NOTICE 'Archived reversal %: removed % August reservation stays and % reservations from TTIMMS Hotel.',v_archive_id,v_stay_count,v_reservation_count;
END $$;
