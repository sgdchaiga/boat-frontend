-- Optional advanced PMS layer. Existing organizations remain unaffected because
-- hotel_config.pms_full_enabled defaults to false and no legacy table is changed.

CREATE TABLE IF NOT EXISTS public.hotel_pms_room_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL, group_name text, room_id uuid REFERENCES public.rooms(id) ON DELETE CASCADE,
  start_date date NOT NULL, end_date date NOT NULL, status text NOT NULL DEFAULT 'tentative' CHECK(status IN ('tentative','confirmed','released','cancelled')),
  notes text, created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(end_date > start_date)
);
CREATE INDEX IF NOT EXISTS hotel_pms_room_blocks_availability_idx ON public.hotel_pms_room_blocks(organization_id,room_id,start_date,end_date) WHERE status IN ('tentative','confirmed');

CREATE TABLE IF NOT EXISTS public.hotel_pms_rate_controls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  room_type_id uuid REFERENCES public.room_types(id) ON DELETE CASCADE, start_date date NOT NULL, end_date date NOT NULL,
  nightly_rate numeric(14,2), minimum_stay integer NOT NULL DEFAULT 1 CHECK(minimum_stay > 0), stop_sell boolean NOT NULL DEFAULT false,
  notes text, created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), CHECK(end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS hotel_pms_rate_controls_lookup_idx ON public.hotel_pms_rate_controls(organization_id,room_type_id,start_date,end_date);

CREATE TABLE IF NOT EXISTS public.hotel_pms_guest_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  property_customer_id uuid REFERENCES public.hotel_customers(id) ON DELETE RESTRICT, reservation_id uuid REFERENCES public.reservations(id) ON DELETE SET NULL,
  stay_id uuid REFERENCES public.stays(id) ON DELETE SET NULL, amount numeric(14,2) NOT NULL CHECK(amount > 0),
  payment_method text NOT NULL DEFAULT 'cash', reference text, status text NOT NULL DEFAULT 'held' CHECK(status IN ('held','applied','refunded','forfeited')),
  received_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hotel_pms_guest_deposits_guest_idx ON public.hotel_pms_guest_deposits(organization_id,property_customer_id,status);

CREATE TABLE IF NOT EXISTS public.hotel_pms_work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL, title text NOT NULL, category text NOT NULL DEFAULT 'maintenance',
  priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','assigned','in_progress','completed','cancelled')),
  assigned_to uuid REFERENCES public.staff(id) ON DELETE SET NULL, description text, due_at timestamptz, completed_at timestamptz,
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hotel_pms_work_orders_open_idx ON public.hotel_pms_work_orders(organization_id,status,priority,created_at);

CREATE TABLE IF NOT EXISTS public.hotel_pms_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE, service_date date NOT NULL DEFAULT current_date,
  result text NOT NULL CHECK(result IN ('pass','rework','out_of_order')), score integer CHECK(score BETWEEN 0 AND 100), notes text,
  inspected_by uuid REFERENCES public.staff(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hotel_pms_inspections_room_idx ON public.hotel_pms_inspections(organization_id,room_id,service_date DESC);

CREATE TABLE IF NOT EXISTS public.hotel_pms_period_closes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  closed_through date NOT NULL, notes text, closed_by uuid REFERENCES public.staff(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,closed_through)
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['hotel_pms_room_blocks','hotel_pms_rate_controls','hotel_pms_guest_deposits','hotel_pms_work_orders','hotel_pms_inspections','hotel_pms_period_closes'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I','pms_org_access_'||t,t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_platform_admin() OR organization_id IN (SELECT s.organization_id FROM public.staff s WHERE s.id=auth.uid() AND COALESCE(s.is_active,true))) WITH CHECK (public.is_platform_admin() OR organization_id IN (SELECT s.organization_id FROM public.staff s WHERE s.id=auth.uid() AND COALESCE(s.is_active,true)))','pms_org_access_'||t,t);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO authenticated',t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
  END LOOP;
END $$;

-- Preserve all centrally stored settings while allowing the new master switch.
CREATE OR REPLACE FUNCTION public.save_organization_hotel_config(p_config jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid; v_clean jsonb;
BEGIN
  SELECT organization_id INTO v_org FROM public.staff WHERE id=auth.uid() AND COALESCE(is_active,true) AND role IN ('super_admin','admin','manager');
  IF v_org IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Not authorized to change hotel configuration.'; END IF;
  IF COALESCE(jsonb_typeof(p_config),'null') <> 'object' THEN RAISE EXCEPTION 'Hotel configuration must be an object.'; END IF;
  v_clean := jsonb_strip_nulls(p_config) || jsonb_build_object('pms_full_enabled',COALESCE((p_config->>'pms_full_enabled')::boolean,false));
  UPDATE public.organizations SET hotel_config=v_clean, address=NULLIF(v_clean->>'address',''), hotel_timezone=COALESCE(NULLIF(v_clean->>'timezone',''),hotel_timezone) WHERE id=v_org;
  RETURN v_clean;
END $$;
REVOKE ALL ON FUNCTION public.save_organization_hotel_config(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_organization_hotel_config(jsonb) TO authenticated;

-- When (and only when) Advanced PMS is enabled, room blocks, stop-sell and
-- minimum-stay controls become authoritative in the existing reservation path.
CREATE OR REPLACE FUNCTION public.enforce_hotel_reservation_availability()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_room_org uuid; v_room_type uuid; v_pms boolean:=false; v_min_stay integer;
BEGIN
  IF NEW.status NOT IN ('pending','confirmed','checked_in') OR NEW.room_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.check_in_date IS NULL OR NEW.check_out_date IS NULL OR NEW.check_out_date<=NEW.check_in_date THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Check-out must be after check-in.'; END IF;
  SELECT organization_id,room_type_id INTO v_room_org,v_room_type FROM public.rooms WHERE id=NEW.room_id;
  IF v_room_org IS NULL OR NEW.organization_id IS DISTINCT FROM v_room_org THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Room does not belong to the reservation organization.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text||':'||NEW.room_id::text,0));
  IF EXISTS(SELECT 1 FROM public.reservations r WHERE r.organization_id=NEW.organization_id AND r.room_id=NEW.room_id AND r.id IS DISTINCT FROM NEW.id AND r.status IN ('pending','confirmed','checked_in') AND daterange(r.check_in_date,r.check_out_date,'[)')&&daterange(NEW.check_in_date,NEW.check_out_date,'[)')) THEN RAISE EXCEPTION USING ERRCODE='23P01',MESSAGE='Room is already reserved for overlapping dates.'; END IF;
  SELECT COALESCE((hotel_config->>'pms_full_enabled')::boolean,false) INTO v_pms FROM public.organizations WHERE id=NEW.organization_id;
  IF v_pms THEN
    IF EXISTS(SELECT 1 FROM public.hotel_pms_room_blocks b WHERE b.organization_id=NEW.organization_id AND b.room_id=NEW.room_id AND b.status IN ('tentative','confirmed') AND daterange(b.start_date,b.end_date,'[)')&&daterange(NEW.check_in_date,NEW.check_out_date,'[)')) THEN RAISE EXCEPTION USING ERRCODE='23P01',MESSAGE='Room is held by an active PMS room block.'; END IF;
    IF EXISTS(SELECT 1 FROM public.hotel_pms_rate_controls c WHERE c.organization_id=NEW.organization_id AND (c.room_type_id IS NULL OR c.room_type_id=v_room_type) AND c.stop_sell AND daterange(c.start_date,c.end_date+1,'[)')&&daterange(NEW.check_in_date,NEW.check_out_date,'[)')) THEN RAISE EXCEPTION USING ERRCODE='23P01',MESSAGE='Room type is stop-sell for the requested dates.'; END IF;
    SELECT max(c.minimum_stay) INTO v_min_stay FROM public.hotel_pms_rate_controls c WHERE c.organization_id=NEW.organization_id AND (c.room_type_id IS NULL OR c.room_type_id=v_room_type) AND daterange(c.start_date,c.end_date+1,'[)')&&daterange(NEW.check_in_date,NEW.check_out_date,'[)');
    IF COALESCE(v_min_stay,1)>(NEW.check_out_date-NEW.check_in_date) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Reservation does not meet the configured minimum stay.'; END IF;
  END IF;
  RETURN NEW;
END $$;

-- Closing a PMS period prevents accidental folio mutation in that period, but
-- only for organizations that deliberately enabled the advanced workspace.
CREATE OR REPLACE FUNCTION public.enforce_hotel_pms_period_close()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid; v_date date; v_close date; v_enabled boolean;
BEGIN
  IF TG_OP='DELETE' THEN v_org:=OLD.organization_id; v_date:=OLD.charged_at::date;
  ELSE v_org:=NEW.organization_id; v_date:=NEW.charged_at::date; END IF;
  SELECT COALESCE((hotel_config->>'pms_full_enabled')::boolean,false) INTO v_enabled FROM public.organizations WHERE id=v_org;
  IF NOT v_enabled THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
  SELECT max(closed_through) INTO v_close FROM public.hotel_pms_period_closes WHERE organization_id=v_org;
  IF v_close IS NOT NULL AND v_date<=v_close THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='This hotel accounting period is closed.'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DROP TRIGGER IF EXISTS trg_hotel_pms_period_close ON public.billing;
CREATE TRIGGER trg_hotel_pms_period_close BEFORE INSERT OR UPDATE OR DELETE ON public.billing FOR EACH ROW EXECUTE FUNCTION public.enforce_hotel_pms_period_close();
