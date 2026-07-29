-- BOAT application releases are assigned per business type and pinned per tenant.
-- Existing organizations deliberately remain on 1.0 when this migration is applied.
ALTER TABLE public.business_types
  ADD COLUMN IF NOT EXISTS current_version text NOT NULL DEFAULT '1.1';
ALTER TABLE public.business_types
  ADD COLUMN IF NOT EXISTS available_versions text[] NOT NULL DEFAULT ARRAY['1.0', '1.1']::text[];

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS app_version text NOT NULL DEFAULT '1.0';

UPDATE public.business_types
SET
  current_version = CASE
    WHEN current_version IS NULL OR btrim(current_version) = '' THEN '1.1'
    ELSE current_version
  END,
  available_versions = (
    SELECT ARRAY(
      SELECT version
      FROM unnest(
        coalesce(available_versions, ARRAY[]::text[])
        || ARRAY['1.0', '1.1', coalesce(nullif(btrim(current_version), ''), '1.1')]
      ) AS version
      GROUP BY version
      ORDER BY string_to_array(version, '.')::int[]
    )
  );

UPDATE public.organizations
SET app_version = '1.0'
WHERE app_version IS NULL OR btrim(app_version) = '';

ALTER TABLE public.business_types
  DROP CONSTRAINT IF EXISTS business_types_current_version_format;
ALTER TABLE public.business_types
  ADD CONSTRAINT business_types_current_version_format
  CHECK (current_version ~ '^[0-9]+(\.[0-9]+){0,2}$');

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_app_version_format;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_app_version_format
  CHECK (app_version ~ '^[0-9]+(\.[0-9]+){0,2}$');

COMMENT ON COLUMN public.business_types.current_version IS
  'Latest BOAT release approved for this business type.';
COMMENT ON COLUMN public.business_types.available_versions IS
  'Published BOAT releases that a platform superadmin may assign to organizations of this type.';
COMMENT ON COLUMN public.organizations.app_version IS
  'BOAT release pinned to this tenant; deployments do not change it automatically.';
