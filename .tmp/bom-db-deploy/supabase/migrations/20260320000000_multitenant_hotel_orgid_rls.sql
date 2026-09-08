-- Multi-tenant isolation for the Hotel module:
-- Add `organization_id` to core hotel tables, backfill using existing relationships,
-- set it for new rows via triggers, and replace permissive RLS with org-scoped RLS.

-- 1) Add organization_id columns
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.room_types ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.stays ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.billing ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.housekeeping_tasks ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

-- 2) Backfill organization_id for existing rows
-- Staff: best-effort for any existing rows without organization_id (use identity match where possible).
UPDATE public.staff s
SET organization_id = s.organization_id
WHERE s.organization_id IS NULL;

-- Guests -> reservations -> staff
UPDATE public.guests g
SET organization_id = sub.organization_id
FROM (
  SELECT r.guest_id AS guest_id, MAX(s.organization_id) AS organization_id
  FROM public.reservations r
  JOIN public.staff s ON s.id = r.created_by
  WHERE r.guest_id IS NOT NULL
    AND s.organization_id IS NOT NULL
  GROUP BY r.guest_id
) sub
WHERE g.id = sub.guest_id
  AND g.organization_id IS NULL;

-- Rooms -> reservations -> staff
UPDATE public.rooms rm
SET organization_id = sub.organization_id
FROM (
  SELECT r.room_id AS room_id, MAX(s.organization_id) AS organization_id
  FROM public.reservations r
  JOIN public.staff s ON s.id = r.created_by
  WHERE r.room_id IS NOT NULL
    AND s.organization_id IS NOT NULL
  GROUP BY r.room_id
) sub
WHERE rm.id = sub.room_id
  AND rm.organization_id IS NULL;

-- Room types -> rooms -> staff
UPDATE public.room_types rt
SET organization_id = sub.organization_id
FROM (
  SELECT rm.room_type_id AS room_type_id, MAX(rm.organization_id) AS organization_id
  FROM public.rooms rm
  WHERE rm.room_type_id IS NOT NULL
    AND rm.organization_id IS NOT NULL
  GROUP BY rm.room_type_id
) sub
WHERE rt.id = sub.room_type_id
  AND rt.organization_id IS NULL;

-- Reservations -> created_by -> staff
UPDATE public.reservations r
SET organization_id = s.organization_id
FROM public.staff s
WHERE r.created_by = s.id
  AND r.organization_id IS NULL
  AND s.organization_id IS NOT NULL;

-- Stays -> reservation -> created_by -> staff
UPDATE public.stays st
SET organization_id = s.organization_id
FROM public.reservations r
JOIN public.staff s ON s.id = r.created_by
WHERE st.reservation_id = r.id
  AND st.organization_id IS NULL
  AND s.organization_id IS NOT NULL;

-- Billing -> created_by -> staff
UPDATE public.billing b
SET organization_id = s.organization_id
FROM public.staff s
WHERE b.created_by = s.id
  AND b.organization_id IS NULL
  AND s.organization_id IS NOT NULL;

-- Payments -> processed_by -> staff
UPDATE public.payments p
SET organization_id = s.organization_id
FROM public.staff s
WHERE p.processed_by = s.id
  AND p.organization_id IS NULL
  AND s.organization_id IS NOT NULL;

-- Housekeeping -> assigned_to -> staff
UPDATE public.housekeeping_tasks ht
SET organization_id = s.organization_id
FROM public.staff s
WHERE ht.assigned_to = s.id
  AND ht.organization_id IS NULL
  AND s.organization_id IS NOT NULL;

-- 3) Triggers: set organization_id on insert
CREATE OR REPLACE FUNCTION public.set_org_id_from_auth_staff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    SELECT s.organization_id INTO NEW.organization_id
    FROM public.staff s
    WHERE s.id = auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_org_staff ON public.staff;
CREATE TRIGGER trg_set_org_staff
BEFORE INSERT ON public.staff
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_room_types ON public.room_types;
CREATE TRIGGER trg_set_org_room_types
BEFORE INSERT ON public.room_types
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_rooms ON public.rooms;
CREATE TRIGGER trg_set_org_rooms
BEFORE INSERT ON public.rooms
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_guests ON public.guests;
CREATE TRIGGER trg_set_org_guests
BEFORE INSERT ON public.guests
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_reservations ON public.reservations;
CREATE TRIGGER trg_set_org_reservations
BEFORE INSERT ON public.reservations
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_stays ON public.stays;
CREATE TRIGGER trg_set_org_stays
BEFORE INSERT ON public.stays
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_billing ON public.billing;
CREATE TRIGGER trg_set_org_billing
BEFORE INSERT ON public.billing
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_payments ON public.payments;
CREATE TRIGGER trg_set_org_payments
BEFORE INSERT ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_housekeeping ON public.housekeeping_tasks;
CREATE TRIGGER trg_set_org_housekeeping
BEFORE INSERT ON public.housekeeping_tasks
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

-- 4) Replace hotel RLS policies with org-scoped policies
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.housekeeping_tasks ENABLE ROW LEVEL SECURITY;

-- staff policies
DROP POLICY IF EXISTS "Staff can view all staff members" ON public.staff;
DROP POLICY IF EXISTS "Admins can insert staff" ON public.staff;
DROP POLICY IF EXISTS "Admins can update staff" ON public.staff;

CREATE POLICY "staff_select_same_org"
  ON public.staff FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

CREATE POLICY "staff_insert_same_org_admin"
  ON public.staff FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff me
      WHERE me.id = auth.uid()
        AND me.role = 'admin'
        AND me.organization_id IS NOT NULL
    )
    AND organization_id = (
      SELECT me.organization_id FROM public.staff me WHERE me.id = auth.uid()
    )
  );

CREATE POLICY "staff_update_same_org_admin"
  ON public.staff FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.staff me
      WHERE me.id = auth.uid()
        AND me.role = 'admin'
        AND me.organization_id IS NOT NULL
    )
    AND organization_id = (
      SELECT me.organization_id FROM public.staff me WHERE me.id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff me
      WHERE me.id = auth.uid()
        AND me.role = 'admin'
        AND me.organization_id IS NOT NULL
    )
    AND organization_id = (
      SELECT me.organization_id FROM public.staff me WHERE me.id = auth.uid()
    )
  );

-- room_types policies
DROP POLICY IF EXISTS "Authenticated staff can view room types" ON public.room_types;
DROP POLICY IF EXISTS "Managers and admins can manage room types" ON public.room_types;

CREATE POLICY "room_types_select_same_org"
  ON public.room_types FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

CREATE POLICY "room_types_manage_same_org_managers"
  ON public.room_types FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = auth.uid()
        AND s.role IN ('admin','manager')
    )
    AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = auth.uid()
        AND s.role IN ('admin','manager')
    )
    AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

-- rooms policies
DROP POLICY IF EXISTS "Authenticated staff can view rooms" ON public.rooms;
DROP POLICY IF EXISTS "Managers and admins can manage rooms" ON public.rooms;
DROP POLICY IF EXISTS "Staff can update room status" ON public.rooms;

CREATE POLICY "rooms_select_same_org"
  ON public.rooms FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

CREATE POLICY "rooms_manage_same_org_managers"
  ON public.rooms FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = auth.uid()
        AND s.role IN ('admin','manager')
        AND s.organization_id IS NOT NULL
    )
    AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

CREATE POLICY "rooms_update_status_same_org_all_staff"
  ON public.rooms FOR UPDATE
  TO authenticated
  USING (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

-- guests policies
DROP POLICY IF EXISTS "Authenticated staff can view guests" ON public.guests;
DROP POLICY IF EXISTS "Receptionists and above can manage guests" ON public.guests;

CREATE POLICY "guests_select_same_org"
  ON public.guests FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

CREATE POLICY "guests_manage_same_org_receptionist_plus"
  ON public.guests FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = auth.uid()
        AND s.role IN ('admin','manager','receptionist')
    )
    AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = auth.uid()
        AND s.role IN ('admin','manager','receptionist')
    )
    AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

-- reservations policies
DROP POLICY IF EXISTS "Authenticated staff can view reservations" ON public.reservations;
DROP POLICY IF EXISTS "Receptionists and above can manage reservations" ON public.reservations;

CREATE POLICY "reservations_select_same_org"
  ON public.reservations FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

CREATE POLICY "reservations_manage_same_org_receptionist_plus"
  ON public.reservations FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = auth.uid()
        AND s.role IN ('admin','manager','receptionist')
    )
    AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = auth.uid()
        AND s.role IN ('admin','manager','receptionist')
    )
    AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

-- stays policies
DROP POLICY IF EXISTS "Authenticated staff can view stays" ON public.stays;
DROP POLICY IF EXISTS "Receptionists and above can manage stays" ON public.stays;

CREATE POLICY "stays_select_same_org"
  ON public.stays FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

CREATE POLICY "stays_manage_same_org_receptionist_plus"
  ON public.stays FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = auth.uid()
        AND s.role IN ('admin','manager','receptionist')
    )
    AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = auth.uid()
        AND s.role IN ('admin','manager','receptionist')
    )
    AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

-- billing policies
DROP POLICY IF EXISTS "Authenticated staff can view billing" ON public.billing;
DROP POLICY IF EXISTS "Receptionists and above can manage billing" ON public.billing;

CREATE POLICY "billing_select_same_org"
  ON public.billing FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

CREATE POLICY "billing_manage_same_org_receptionist_plus"
  ON public.billing FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = auth.uid()
        AND s.role IN ('admin','manager','receptionist')
    )
    AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = auth.uid()
        AND s.role IN ('admin','manager','receptionist')
    )
    AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

-- payments policies
DROP POLICY IF EXISTS "Authenticated staff can view payments" ON public.payments;
DROP POLICY IF EXISTS "Receptionists and above can manage payments" ON public.payments;

CREATE POLICY "payments_select_same_org"
  ON public.payments FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

CREATE POLICY "payments_manage_same_org_receptionist_plus"
  ON public.payments FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = auth.uid()
        AND s.role IN ('admin','manager','receptionist')
    )
    AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = auth.uid()
        AND s.role IN ('admin','manager','receptionist')
    )
    AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

-- housekeeping_tasks policies
DROP POLICY IF EXISTS "Authenticated staff can view housekeeping tasks" ON public.housekeeping_tasks;
DROP POLICY IF EXISTS "Managers can manage housekeeping tasks" ON public.housekeeping_tasks;
DROP POLICY IF EXISTS "Assigned staff can update their tasks" ON public.housekeeping_tasks;

CREATE POLICY "housekeeping_select_same_org"
  ON public.housekeeping_tasks FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

CREATE POLICY "housekeeping_insert_same_org_admin_manager"
  ON public.housekeeping_tasks FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = auth.uid()
        AND s.role IN ('admin','manager')
        AND s.organization_id IS NOT NULL
    )
    AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

CREATE POLICY "housekeeping_update_same_org_assigned_or_admin_manager"
  ON public.housekeeping_tasks FOR UPDATE
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
    AND (
      assigned_to = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.staff s
        WHERE s.id = auth.uid()
          AND s.role IN ('admin','manager')
      )
    )
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
    AND (
      assigned_to = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.staff s
        WHERE s.id = auth.uid()
          AND s.role IN ('admin','manager')
      )
    )
  );

