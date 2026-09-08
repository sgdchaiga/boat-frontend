-- Room-service observations, evidence photos, and laundry issue/return reconciliation.

ALTER TABLE public.housekeeping_attendant_sheets
  ADD COLUMN IF NOT EXISTS occupancy_observed text
    CHECK (occupancy_observed IN ('occupied', 'vacant')),
  ADD COLUMN IF NOT EXISTS cleaned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS linen_changed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS towels_changed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS missing_items text,
  ADD COLUMN IF NOT EXISTS photo_path text,
  ADD COLUMN IF NOT EXISTS entry_mode text NOT NULL DEFAULT 'quick'
    CHECK (entry_mode IN ('quick', 'quantities'));

CREATE TABLE IF NOT EXISTS public.housekeeping_laundry_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  movement_date date NOT NULL DEFAULT CURRENT_DATE,
  movement_type text NOT NULL CHECK (movement_type IN ('issue', 'return')),
  bed_sheets integer NOT NULL DEFAULT 0 CHECK (bed_sheets >= 0),
  pillow_cases integer NOT NULL DEFAULT 0 CHECK (pillow_cases >= 0),
  bath_towels integer NOT NULL DEFAULT 0 CHECK (bath_towels >= 0),
  hand_towels integer NOT NULL DEFAULT 0 CHECK (hand_towels >= 0),
  bath_mats integer NOT NULL DEFAULT 0 CHECK (bath_mats >= 0),
  notes text,
  recorded_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_housekeeping_laundry_movements_org_date
  ON public.housekeeping_laundry_movements (organization_id, movement_date DESC);

DROP TRIGGER IF EXISTS trg_set_org_housekeeping_laundry_movements ON public.housekeeping_laundry_movements;
CREATE TRIGGER trg_set_org_housekeeping_laundry_movements
BEFORE INSERT ON public.housekeeping_laundry_movements
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

ALTER TABLE public.housekeeping_laundry_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "housekeeping_laundry_movements_same_org" ON public.housekeeping_laundry_movements;
CREATE POLICY "housekeeping_laundry_movements_same_org"
  ON public.housekeeping_laundry_movements FOR ALL TO authenticated
  USING (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
  WITH CHECK (organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()));

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'housekeeping-photos',
  'housekeeping-photos',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "housekeeping_photos_select_org" ON storage.objects;
DROP POLICY IF EXISTS "housekeeping_photos_insert_org" ON storage.objects;
DROP POLICY IF EXISTS "housekeeping_photos_update_org" ON storage.objects;
DROP POLICY IF EXISTS "housekeeping_photos_delete_org" ON storage.objects;

CREATE POLICY "housekeeping_photos_select_org"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'housekeeping-photos' AND (storage.foldername(name))[1] = public.staff_organization_id_text());

CREATE POLICY "housekeeping_photos_insert_org"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'housekeeping-photos' AND (storage.foldername(name))[1] = public.staff_organization_id_text());

CREATE POLICY "housekeeping_photos_update_org"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'housekeeping-photos' AND (storage.foldername(name))[1] = public.staff_organization_id_text())
  WITH CHECK (bucket_id = 'housekeeping-photos' AND (storage.foldername(name))[1] = public.staff_organization_id_text());

CREATE POLICY "housekeeping_photos_delete_org"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'housekeeping-photos' AND (storage.foldername(name))[1] = public.staff_organization_id_text());

COMMENT ON TABLE public.housekeeping_laundry_movements IS
  'Daily clean-linen issues to housekeeping and soiled-linen returns to laundry.';
