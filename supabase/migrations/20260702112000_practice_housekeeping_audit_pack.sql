-- Accounting practice: explicitly link client records to BOAT hotel organizations
-- and expose a tenant-checked monthly housekeeping/laundry audit dataset.

ALTER TABLE public.practice_clients
  ADD COLUMN IF NOT EXISTS linked_organization_id uuid
  REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_practice_clients_linked_org
  ON public.practice_clients (linked_organization_id)
  WHERE linked_organization_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.practice_available_hotel_organizations()
RETURNS TABLE (id uuid, name text, business_type text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_org uuid;
  caller_type text;
BEGIN
  SELECT s.organization_id INTO caller_org FROM public.staff s WHERE s.id = auth.uid();
  SELECT o.business_type INTO caller_type FROM public.organizations o WHERE o.id = caller_org;
  IF caller_org IS NULL OR caller_type <> 'accounting_practice' THEN
    RAISE EXCEPTION 'Accounting practice access required';
  END IF;

  RETURN QUERY
  SELECT o.id, o.name, o.business_type
  FROM public.organizations o
  WHERE o.business_type IN ('hotel', 'mixed')
    AND EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.user_id = auth.uid() AND om.organization_id = o.id AND om.is_active = true
    )
  ORDER BY o.name;
END;
$$;

CREATE OR REPLACE FUNCTION public.practice_link_hotel_client(p_client_id uuid, p_hotel_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_org uuid;
  hotel_type text;
BEGIN
  SELECT s.organization_id INTO caller_org FROM public.staff s WHERE s.id = auth.uid();
  IF caller_org IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.organizations o WHERE o.id = caller_org AND o.business_type = 'accounting_practice'
  ) THEN
    RAISE EXCEPTION 'Accounting practice access required';
  END IF;
  SELECT o.business_type INTO hotel_type FROM public.organizations o WHERE o.id = p_hotel_organization_id;
  IF hotel_type NOT IN ('hotel', 'mixed') THEN RAISE EXCEPTION 'Selected organization is not a hotel client'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = auth.uid() AND om.organization_id = p_hotel_organization_id AND om.is_active = true
  ) THEN RAISE EXCEPTION 'You need active access to the selected hotel organization'; END IF;

  UPDATE public.practice_clients
  SET linked_organization_id = p_hotel_organization_id
  WHERE id = p_client_id AND organization_id = caller_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Practice client not found'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.practice_housekeeping_laundry_audit(p_client_id uuid, p_month_start date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_org uuid;
  hotel_org uuid;
  client_name text;
  hotel_name text;
  total_rooms integer;
  month_start date := date_trunc('month', p_month_start)::date;
  month_end date := (date_trunc('month', p_month_start) + interval '1 month')::date;
  room_rows jsonb;
  laundry_rows jsonb;
BEGIN
  SELECT s.organization_id INTO caller_org FROM public.staff s WHERE s.id = auth.uid();
  IF caller_org IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.organizations o WHERE o.id = caller_org AND o.business_type = 'accounting_practice'
  ) THEN
    RAISE EXCEPTION 'Accounting practice access required';
  END IF;

  SELECT pc.linked_organization_id, pc.name
  INTO hotel_org, client_name
  FROM public.practice_clients pc
  WHERE pc.id = p_client_id AND pc.organization_id = caller_org AND pc.status = 'active';
  IF hotel_org IS NULL THEN RAISE EXCEPTION 'Link this practice client to a BOAT hotel organization first'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = auth.uid() AND om.organization_id = hotel_org AND om.is_active = true
  ) THEN RAISE EXCEPTION 'Your access to this hotel organization is not active'; END IF;
  SELECT o.name INTO hotel_name FROM public.organizations o WHERE o.id = hotel_org AND o.business_type IN ('hotel', 'mixed');
  IF hotel_name IS NULL THEN RAISE EXCEPTION 'Linked hotel organization is unavailable'; END IF;
  SELECT count(*)::integer INTO total_rooms FROM public.rooms r WHERE r.organization_id = hotel_org;

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.service_date, x.room_number), '[]'::jsonb)
  INTO room_rows
  FROM (
    SELECT hs.id, hs.service_date, hs.room_id, r.room_number,
      hs.attendant_id, COALESCE(st.full_name, 'Unassigned') AS attendant_name,
      hs.occupancy_observed, hs.cleaned, hs.linen_changed, hs.towels_changed,
      hs.bed_sheets, hs.pillow_cases, hs.bath_towels, hs.hand_towels, hs.bath_mats,
      hs.missing_items, hs.notes, hs.photo_path, hs.entry_mode, hs.created_at
    FROM public.housekeeping_attendant_sheets hs
    LEFT JOIN public.rooms r ON r.id = hs.room_id
    LEFT JOIN public.staff st ON st.id = hs.attendant_id
    WHERE hs.organization_id = hotel_org
      AND hs.service_date >= month_start AND hs.service_date < month_end
  ) x;

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.movement_date, x.created_at), '[]'::jsonb)
  INTO laundry_rows
  FROM (
    SELECT lm.id, lm.movement_date, lm.movement_type,
      lm.bed_sheets, lm.pillow_cases, lm.bath_towels, lm.hand_towels, lm.bath_mats,
      lm.notes, COALESCE(st.full_name, 'Unassigned') AS recorded_by_name, lm.created_at
    FROM public.housekeeping_laundry_movements lm
    LEFT JOIN public.staff st ON st.id = lm.recorded_by
    WHERE lm.organization_id = hotel_org
      AND lm.movement_date >= month_start AND lm.movement_date < month_end
  ) x;

  RETURN jsonb_build_object(
    'client_id', p_client_id,
    'client_name', client_name,
    'hotel_organization_id', hotel_org,
    'hotel_name', hotel_name,
    'total_rooms', total_rooms,
    'month_start', month_start,
    'month_end_exclusive', month_end,
    'room_entries', room_rows,
    'laundry_movements', laundry_rows,
    'generated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.practice_available_hotel_organizations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.practice_link_hotel_client(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.practice_housekeeping_laundry_audit(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.practice_available_hotel_organizations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.practice_link_hotel_client(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.practice_housekeeping_laundry_audit(uuid, date) TO authenticated;

DROP POLICY IF EXISTS "housekeeping_photos_practice_audit_select" ON storage.objects;
CREATE POLICY "housekeeping_photos_practice_audit_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'housekeeping-photos'
    AND EXISTS (
      SELECT 1
      FROM public.practice_clients pc
      JOIN public.staff s ON s.organization_id = pc.organization_id
      WHERE s.id = auth.uid()
        AND pc.status = 'active'
        AND pc.linked_organization_id::text = (storage.foldername(name))[1]
        AND EXISTS (
          SELECT 1 FROM public.organization_members om
          WHERE om.user_id = auth.uid() AND om.organization_id = pc.linked_organization_id AND om.is_active = true
        )
    )
  );

COMMENT ON COLUMN public.practice_clients.linked_organization_id IS
  'BOAT organization whose operational records belong to this practice client.';
