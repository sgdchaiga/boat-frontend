-- Daily room-attendant sheet and linen/towel usage by room.

CREATE TABLE IF NOT EXISTS public.housekeeping_attendant_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  service_date date NOT NULL DEFAULT CURRENT_DATE,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  attendant_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  bed_sheets integer NOT NULL DEFAULT 0 CHECK (bed_sheets >= 0),
  pillow_cases integer NOT NULL DEFAULT 0 CHECK (pillow_cases >= 0),
  bath_towels integer NOT NULL DEFAULT 0 CHECK (bath_towels >= 0),
  hand_towels integer NOT NULL DEFAULT 0 CHECK (hand_towels >= 0),
  bath_mats integer NOT NULL DEFAULT 0 CHECK (bath_mats >= 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, service_date, room_id)
);

CREATE INDEX IF NOT EXISTS idx_housekeeping_attendant_sheets_org_date
  ON public.housekeeping_attendant_sheets (organization_id, service_date DESC);

DROP TRIGGER IF EXISTS trg_set_org_housekeeping_attendant_sheets ON public.housekeeping_attendant_sheets;
CREATE TRIGGER trg_set_org_housekeeping_attendant_sheets
BEFORE INSERT ON public.housekeeping_attendant_sheets
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

CREATE OR REPLACE FUNCTION public.touch_housekeeping_attendant_sheets_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_housekeeping_attendant_sheets ON public.housekeeping_attendant_sheets;
CREATE TRIGGER trg_touch_housekeeping_attendant_sheets
BEFORE UPDATE ON public.housekeeping_attendant_sheets
FOR EACH ROW EXECUTE FUNCTION public.touch_housekeeping_attendant_sheets_updated_at();

ALTER TABLE public.housekeeping_attendant_sheets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "housekeeping_attendant_sheets_same_org" ON public.housekeeping_attendant_sheets;
CREATE POLICY "housekeeping_attendant_sheets_same_org"
  ON public.housekeeping_attendant_sheets FOR ALL TO authenticated
  USING (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
  WITH CHECK (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

COMMENT ON TABLE public.housekeeping_attendant_sheets IS
  'Daily room-attendant entries with per-room linen and towel usage.';
