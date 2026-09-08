-- Hotel commercialization integrity controls:
-- 1. tenant-scoped room/type uniqueness
-- 2. concurrency-safe reservation overlap protection
-- 3. atomic check-in and checkout
-- 4. atomic manual folio charge + room revenue journal posting

-- Global uniqueness prevents separate hotels from both using common labels such
-- as "Standard" and "101". Preserve uniqueness inside each organization only.
ALTER TABLE public.room_types DROP CONSTRAINT IF EXISTS room_types_name_key;
ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS rooms_room_number_key;

CREATE UNIQUE INDEX IF NOT EXISTS room_types_org_name_uq
  ON public.room_types (organization_id, lower(name))
  WHERE organization_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS rooms_org_number_uq
  ON public.rooms (organization_id, lower(room_number))
  WHERE organization_id IS NOT NULL;

-- Serialize every reservation mutation for a room and reject overlapping active
-- bookings in the database. The advisory transaction lock closes the race that
-- exists when two front desks check availability at the same time.
CREATE OR REPLACE FUNCTION public.enforce_hotel_reservation_availability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room_org uuid;
BEGIN
  IF NEW.status NOT IN ('pending', 'confirmed', 'checked_in') OR NEW.room_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.check_in_date IS NULL OR NEW.check_out_date IS NULL OR NEW.check_out_date <= NEW.check_in_date THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Check-out must be after check-in.';
  END IF;

  SELECT organization_id INTO v_room_org
  FROM public.rooms
  WHERE id = NEW.room_id;
  IF v_room_org IS NULL OR NEW.organization_id IS DISTINCT FROM v_room_org THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Room does not belong to the reservation organization.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text || ':' || NEW.room_id::text, 0));
  IF EXISTS (
    SELECT 1
    FROM public.reservations r
    WHERE r.organization_id = NEW.organization_id
      AND r.room_id = NEW.room_id
      AND r.id IS DISTINCT FROM NEW.id
      AND r.status IN ('pending', 'confirmed', 'checked_in')
      AND daterange(r.check_in_date, r.check_out_date, '[)')
          && daterange(NEW.check_in_date, NEW.check_out_date, '[)')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23P01', MESSAGE = 'Room is already reserved for overlapping dates.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_hotel_reservation_availability ON public.reservations;
CREATE TRIGGER trg_enforce_hotel_reservation_availability
BEFORE INSERT OR UPDATE OF organization_id, room_id, check_in_date, check_out_date, status
ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.enforce_hotel_reservation_availability();

CREATE OR REPLACE FUNCTION public.hotel_check_in_reservation(
  p_reservation_id uuid,
  p_actual_check_in timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res public.reservations%ROWTYPE;
  v_existing public.stays%ROWTYPE;
  v_stay_id uuid;
  v_actor uuid := auth.uid();
  v_staff_actor uuid;
BEGIN
  SELECT * INTO v_res FROM public.reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found.'; END IF;
  IF NOT public.is_platform_admin() AND NOT EXISTS (
    SELECT 1 FROM public.staff s
    WHERE s.id = v_actor AND s.organization_id = v_res.organization_id AND COALESCE(s.is_active, true)
      AND s.role IN ('super_admin','admin','manager','receptionist','accountant','supervisor')
  ) THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Not authorized to check in this reservation.'; END IF;
  SELECT id INTO v_staff_actor FROM public.staff WHERE id=v_actor AND organization_id=v_res.organization_id;

  SELECT * INTO v_existing FROM public.stays WHERE reservation_id = v_res.id ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    IF v_existing.actual_check_out IS NULL THEN
      RETURN jsonb_build_object('ok', true, 'idempotent', true, 'stay_id', v_existing.id);
    END IF;
    RAISE EXCEPTION 'This reservation has already been checked out.';
  END IF;
  IF v_res.status NOT IN ('pending','confirmed') THEN RAISE EXCEPTION 'Reservation is not available for check-in.'; END IF;
  IF v_res.room_id IS NULL OR v_res.property_customer_id IS NULL THEN RAISE EXCEPTION 'Reservation is missing its room or customer.'; END IF;

  PERFORM 1 FROM public.rooms rm WHERE rm.id=v_res.room_id AND rm.organization_id=v_res.organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation room was not found in this organization.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_res.organization_id::text || ':' || v_res.room_id::text, 0));
  IF EXISTS (SELECT 1 FROM public.stays s WHERE s.organization_id=v_res.organization_id AND s.room_id=v_res.room_id AND s.actual_check_out IS NULL) THEN
    RAISE EXCEPTION 'Room already has an active stay.';
  END IF;

  INSERT INTO public.stays (
    reservation_id, property_customer_id, room_id, actual_check_in, checked_in_by,
    room_discount_amount, room_discount_reason, rate_plan_id, organization_id
  ) VALUES (
    v_res.id, v_res.property_customer_id, v_res.room_id, COALESCE(p_actual_check_in, now()), v_staff_actor,
    COALESCE(v_res.room_discount_amount,0), v_res.room_discount_reason, v_res.rate_plan_id, v_res.organization_id
  ) RETURNING id INTO v_stay_id;

  UPDATE public.reservations SET status='checked_in' WHERE id=v_res.id;
  UPDATE public.rooms SET status='occupied' WHERE id=v_res.room_id;
  PERFORM public.ensure_room_breakfast_entitlement(v_stay_id);
  RETURN jsonb_build_object('ok', true, 'idempotent', false, 'stay_id', v_stay_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.hotel_check_out_stay(
  p_stay_id uuid,
  p_checkout_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stay public.stays%ROWTYPE;
  v_actor uuid := auth.uid();
  v_staff_actor uuid;
  v_timezone text;
  v_checkout timestamptz;
  v_was_checked_out boolean;
BEGIN
  IF p_checkout_date IS NULL THEN RAISE EXCEPTION 'Checkout date is required.'; END IF;
  SELECT * INTO v_stay FROM public.stays WHERE id=p_stay_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stay not found.'; END IF;
  IF NOT public.is_platform_admin() AND NOT EXISTS (
    SELECT 1 FROM public.staff s
    WHERE s.id=v_actor AND s.organization_id=v_stay.organization_id AND COALESCE(s.is_active,true)
      AND s.role IN ('super_admin','admin','manager','receptionist','accountant','supervisor')
  ) THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Not authorized to check out this stay.'; END IF;
  SELECT id INTO v_staff_actor FROM public.staff WHERE id=v_actor AND organization_id=v_stay.organization_id;

  v_timezone := COALESCE((SELECT hotel_timezone FROM public.organizations WHERE id=v_stay.organization_id),'UTC');
  v_checkout := ((p_checkout_date::text || ' 12:00:00')::timestamp AT TIME ZONE v_timezone);
  IF v_checkout < v_stay.actual_check_in THEN RAISE EXCEPTION 'Checkout cannot be before check-in.'; END IF;
  v_was_checked_out := v_stay.actual_check_out IS NOT NULL;

  PERFORM 1 FROM public.rooms rm WHERE rm.id=v_stay.room_id FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_stay.organization_id::text || ':' || v_stay.room_id::text, 0));
  UPDATE public.stays SET actual_check_out=v_checkout, checked_out_by=v_staff_actor WHERE id=v_stay.id;
  IF NOT v_was_checked_out AND v_stay.reservation_id IS NOT NULL THEN
    UPDATE public.reservations SET status='checked_out' WHERE id=v_stay.reservation_id;
  END IF;
  IF NOT v_was_checked_out THEN
    UPDATE public.rooms SET status='cleaning' WHERE id=v_stay.room_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'stay_id', v_stay.id, 'actual_check_out', v_checkout);
END;
$$;

CREATE OR REPLACE FUNCTION public.save_hotel_folio_charge(
  p_stay_id uuid,
  p_description text,
  p_charge_type text,
  p_amount numeric,
  p_charge_date date,
  p_billing_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stay public.stays%ROWTYPE;
  v_existing public.billing%ROWTYPE;
  v_actor uuid := auth.uid();
  v_staff_actor uuid;
  v_billing_id uuid;
  v_journal_id uuid;
  v_receivable uuid;
  v_revenue uuid;
  v_timezone text;
BEGIN
  IF NULLIF(trim(COALESCE(p_description,'')),'') IS NULL THEN RAISE EXCEPTION 'Description is required.'; END IF;
  IF COALESCE(p_amount,0) <= 0 THEN RAISE EXCEPTION 'Charge amount must be greater than zero.'; END IF;
  IF p_charge_date IS NULL THEN RAISE EXCEPTION 'Charge date is required.'; END IF;
  IF p_charge_type NOT IN ('room','service','food','other') THEN RAISE EXCEPTION 'Invalid charge type.'; END IF;

  SELECT * INTO v_stay FROM public.stays WHERE id=p_stay_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stay not found.'; END IF;
  IF NOT public.is_platform_admin() AND NOT EXISTS (
    SELECT 1 FROM public.staff s
    WHERE s.id=v_actor AND s.organization_id=v_stay.organization_id AND COALESCE(s.is_active,true)
      AND s.role IN ('super_admin','admin','manager','receptionist','accountant','supervisor')
  ) THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Not authorized to post this folio charge.'; END IF;
  SELECT id INTO v_staff_actor FROM public.staff WHERE id=v_actor AND organization_id=v_stay.organization_id;
  IF p_billing_id IS NOT NULL AND NOT public.is_platform_admin() AND NOT EXISTS (
    SELECT 1 FROM public.staff s WHERE s.id=v_actor AND s.organization_id=v_stay.organization_id
      AND COALESCE(s.is_active,true) AND s.role IN ('super_admin','admin','manager','accountant','supervisor')
  ) THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Not authorized to edit folio charges.'; END IF;
  v_timezone := COALESCE((SELECT hotel_timezone FROM public.organizations WHERE id=v_stay.organization_id),'UTC');

  IF p_billing_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.billing WHERE id=p_billing_id FOR UPDATE;
    IF NOT FOUND OR v_existing.organization_id IS DISTINCT FROM v_stay.organization_id OR v_existing.stay_id IS DISTINCT FROM v_stay.id THEN
      RAISE EXCEPTION 'Folio charge was not found for this stay.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.journal_entries je WHERE je.reference_type='room_charge' AND je.reference_id=p_billing_id AND COALESCE(je.is_deleted,false)=false) THEN
      UPDATE public.journal_entries SET is_deleted=true,deleted_at=now(),deleted_by=v_actor
      WHERE reference_type='room_charge' AND reference_id=p_billing_id AND COALESCE(is_deleted,false)=false;
    END IF;
    UPDATE public.billing SET
      description=trim(p_description), charge_type=p_charge_type, amount=p_amount,
      charged_at=((p_charge_date::text || ' 12:00:00')::timestamp AT TIME ZONE v_timezone),
      stay_night_date=CASE WHEN p_charge_type='room' THEN p_charge_date ELSE NULL END,
      auto_charge_source='manual'
    WHERE id=p_billing_id RETURNING id INTO v_billing_id;
  ELSE
    INSERT INTO public.billing (
      organization_id,stay_id,description,charge_type,amount,charged_at,created_by,stay_night_date,auto_charge_source
    ) VALUES (
      v_stay.organization_id,v_stay.id,trim(p_description),p_charge_type,p_amount,
      ((p_charge_date::text || ' 12:00:00')::timestamp AT TIME ZONE v_timezone),v_staff_actor,
      CASE WHEN p_charge_type='room' THEN p_charge_date ELSE NULL END,'manual'
    ) RETURNING id INTO v_billing_id;
  END IF;

  IF p_charge_type='room' THEN
    SELECT receivable_gl_account_id,revenue_gl_account_id INTO v_receivable,v_revenue
    FROM public.journal_gl_settings WHERE organization_id=v_stay.organization_id;
    IF v_receivable IS NULL OR v_revenue IS NULL THEN
      RAISE EXCEPTION 'Configure hotel receivable and revenue accounts before posting room charges.';
    END IF;
    v_journal_id := public.create_journal_entry_atomic(
      p_charge_date,'Room charge: ' || trim(p_description),'room_charge',v_billing_id,v_staff_actor,
      jsonb_build_array(
        jsonb_build_object('gl_account_id',v_receivable::text,'debit',p_amount,'credit',0,'line_description',trim(p_description)),
        jsonb_build_object('gl_account_id',v_revenue::text,'debit',0,'credit',p_amount,'line_description','Room revenue')
      ),v_stay.organization_id
    );
  END IF;
  RETURN jsonb_build_object('ok',true,'billing_id',v_billing_id,'journal_id',v_journal_id);
END;
$$;

REVOKE ALL ON FUNCTION public.hotel_check_in_reservation(uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hotel_check_out_stay(uuid,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_hotel_folio_charge(uuid,text,text,numeric,date,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hotel_check_in_reservation(uuid,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hotel_check_out_stay(uuid,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_hotel_folio_charge(uuid,text,text,numeric,date,uuid) TO authenticated;
