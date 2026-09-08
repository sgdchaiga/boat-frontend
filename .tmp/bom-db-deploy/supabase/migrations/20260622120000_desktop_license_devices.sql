ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS desktop_device_limit integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.organizations.desktop_device_limit IS
  'Maximum active BOAT desktop devices allowed for this organization subscription.';

CREATE TABLE IF NOT EXISTS public.organization_license_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  device_label text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_license_devices_org_device_uq UNIQUE (organization_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_org_license_devices_org_active
  ON public.organization_license_devices (organization_id, revoked_at, last_seen_at DESC);

CREATE OR REPLACE FUNCTION public.touch_organization_license_devices_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_org_license_devices_touch_updated ON public.organization_license_devices;
CREATE TRIGGER trg_org_license_devices_touch_updated
BEFORE UPDATE ON public.organization_license_devices
FOR EACH ROW
EXECUTE FUNCTION public.touch_organization_license_devices_updated_at();

ALTER TABLE public.organization_license_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_license_devices_platform_admin_all" ON public.organization_license_devices;
CREATE POLICY "org_license_devices_platform_admin_all"
  ON public.organization_license_devices
  FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "org_license_devices_same_org_select" ON public.organization_license_devices;
CREATE POLICY "org_license_devices_same_org_select"
  ON public.organization_license_devices
  FOR SELECT
  TO authenticated
  USING (
    organization_id = (
      SELECT s.organization_id
      FROM public.staff s
      WHERE s.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "org_license_devices_same_org_write" ON public.organization_license_devices;
CREATE POLICY "org_license_devices_same_org_write"
  ON public.organization_license_devices
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = (
      SELECT s.organization_id
      FROM public.staff s
      WHERE s.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "org_license_devices_same_org_update" ON public.organization_license_devices;
CREATE POLICY "org_license_devices_same_org_update"
  ON public.organization_license_devices
  FOR UPDATE
  TO authenticated
  USING (
    organization_id = (
      SELECT s.organization_id
      FROM public.staff s
      WHERE s.id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id = (
      SELECT s.organization_id
      FROM public.staff s
      WHERE s.id = auth.uid()
    )
  );
