-- General Business / Accounting is a profile over BOAT's shared accounting engine.
-- Keep this migration self-contained in case the application-version migration
-- has not yet been applied in the target database.
ALTER TABLE public.business_types
  ADD COLUMN IF NOT EXISTS current_version text NOT NULL DEFAULT '1.1';
ALTER TABLE public.business_types
  ADD COLUMN IF NOT EXISTS available_versions text[] NOT NULL DEFAULT ARRAY['1.0', '1.1']::text[];

INSERT INTO public.business_types (code, name, is_active, sort_order, current_version, available_versions)
VALUES ('general_business', 'General Business / Accounting', true, 75, '1.1', ARRAY['1.0', '1.1']::text[])
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  is_active = true,
  current_version = EXCLUDED.current_version,
  available_versions = (
    SELECT ARRAY(
      SELECT version
      FROM unnest(public.business_types.available_versions || EXCLUDED.available_versions) AS version
      GROUP BY version
      ORDER BY string_to_array(version, '.')::int[]
    )
  );

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS sales_workflow text NOT NULL DEFAULT 'both';

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_sales_workflow_check;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_sales_workflow_check
  CHECK (sales_workflow IN ('invoice', 'quick_sale', 'both'));

COMMENT ON COLUMN public.organizations.sales_workflow IS
  'Primary sales experience: invoice, quick_sale (POS), or both.';
