-- Read-only production audit requested before reversing TTIMMS Hotel's
-- reservation/check-in workflow stays for August 2026.
DO $$
DECLARE
  v_org uuid;
  v_stays integer;
  v_reservations integer;
  v_bills integer;
  v_bill_total numeric;
  v_payments integer;
  v_payment_total numeric;
  v_journals integer;
BEGIN
  SELECT id INTO STRICT v_org FROM public.organizations WHERE slug='ttims';

  WITH target_stays AS (
    SELECT s.id,s.reservation_id
    FROM public.stays s
    WHERE s.organization_id=v_org
      AND s.reservation_id IS NOT NULL
      AND (s.actual_check_in AT TIME ZONE COALESCE((SELECT hotel_timezone FROM public.organizations WHERE id=v_org),'UTC'))::date
          BETWEEN DATE '2026-08-01' AND DATE '2026-08-31'
  )
  SELECT count(*),count(DISTINCT reservation_id) INTO v_stays,v_reservations FROM target_stays;

  WITH target_stays AS (
    SELECT s.id FROM public.stays s WHERE s.organization_id=v_org AND s.reservation_id IS NOT NULL
      AND (s.actual_check_in AT TIME ZONE COALESCE((SELECT hotel_timezone FROM public.organizations WHERE id=v_org),'UTC'))::date
          BETWEEN DATE '2026-08-01' AND DATE '2026-08-31'
  )
  SELECT count(*),COALESCE(sum(b.amount),0) INTO v_bills,v_bill_total
  FROM public.billing b JOIN target_stays t ON t.id=b.stay_id;

  WITH target_stays AS (
    SELECT s.id FROM public.stays s WHERE s.organization_id=v_org AND s.reservation_id IS NOT NULL
      AND (s.actual_check_in AT TIME ZONE COALESCE((SELECT hotel_timezone FROM public.organizations WHERE id=v_org),'UTC'))::date
          BETWEEN DATE '2026-08-01' AND DATE '2026-08-31'
  )
  SELECT count(*),COALESCE(sum(p.amount),0) INTO v_payments,v_payment_total
  FROM public.payments p JOIN target_stays t ON t.id=p.stay_id;

  WITH target_stays AS (
    SELECT s.id FROM public.stays s WHERE s.organization_id=v_org AND s.reservation_id IS NOT NULL
      AND (s.actual_check_in AT TIME ZONE COALESCE((SELECT hotel_timezone FROM public.organizations WHERE id=v_org),'UTC'))::date
          BETWEEN DATE '2026-08-01' AND DATE '2026-08-31'
  ), target_bills AS (SELECT b.id FROM public.billing b JOIN target_stays t ON t.id=b.stay_id),
  target_payments AS (SELECT p.id FROM public.payments p JOIN target_stays t ON t.id=p.stay_id)
  SELECT count(*) INTO v_journals FROM public.journal_entries je
  WHERE je.organization_id=v_org AND COALESCE(je.is_deleted,false)=false
    AND ((je.reference_type='room_charge' AND je.reference_id IN(SELECT id FROM target_bills))
      OR (je.reference_type='payment' AND je.reference_id IN(SELECT id FROM target_payments)));

  RAISE NOTICE 'TTIMMS_AUGUST_REVERSAL_PREVIEW org=% stays=% reservations=% bills=% bill_total=% payments=% payment_total=% active_journals=%',
    v_org,v_stays,v_reservations,v_bills,v_bill_total,v_payments,v_payment_total,v_journals;
END $$;
