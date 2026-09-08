-- Seed default departments per business type
-- - Backfills existing organizations
-- - Ensures new organizations get defaults via an AFTER INSERT trigger

-- Ensure tenant column exists (idempotent)
ALTER TABLE public.departments
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

-- Seed function
CREATE OR REPLACE FUNCTION public.seed_default_departments_for_org(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  bt text;
BEGIN
  SELECT business_type INTO bt
  FROM public.organizations
  WHERE id = p_org_id;

  bt := COALESCE(bt, 'hotel');

  -- Insert template departments; skip ones that already exist for the org (case-insensitive).
  INSERT INTO public.departments (organization_id, name)
  SELECT
    p_org_id,
    t.department_name
  FROM (
    VALUES
      -- HOTEL
      ('hotel', 'Kitchen'),
      ('hotel', 'Food'),
      ('hotel', 'Bar'),
      ('hotel', 'Other'),

      -- RETAIL
      ('retail', 'Retail'),
      ('retail', 'Merchandise'),
      ('retail', 'General'),

      -- RESTAURANT (treated as its own template)
      ('restaurant', 'Food'),
      ('restaurant', 'Beverages'),
      ('restaurant', 'Merchandise'),
      ('restaurant', 'General'),

      -- MIXED (union of hotel + retail)
      ('mixed', 'Kitchen'),
      ('mixed', 'Food'),
      ('mixed', 'Bar'),
      ('mixed', 'Retail'),
      ('mixed', 'Merchandise'),
      ('mixed', 'General'),

      -- OTHER
      ('other', 'General')
  ) AS t(business_type, department_name)
  WHERE t.business_type = bt
    AND NOT EXISTS (
      SELECT 1
      FROM public.departments d
      WHERE d.organization_id = p_org_id
        AND lower(d.name) = lower(t.department_name)
    );
END;
$$;

-- Backfill existing orgs that don't have departments yet
DO $do_backfill$
DECLARE
  o uuid;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'seed_default_departments_for_org'
  ) THEN
    FOR o IN
      SELECT id FROM public.organizations
    LOOP
      PERFORM public.seed_default_departments_for_org(o);
    END LOOP;
  END IF;
END
$do_backfill$;

-- Trigger for future orgs
DO $do_trigger$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'seed_default_departments_for_org'
  ) THEN
    -- Wrapper trigger function so we can safely call with NEW.id
    CREATE OR REPLACE FUNCTION public.trg_seed_default_departments_on_org_insert()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    SET row_security = off
    AS $trg_body$
    BEGIN
      PERFORM public.seed_default_departments_for_org(NEW.id);
      RETURN NEW;
    END;
    $trg_body$;

    DROP TRIGGER IF EXISTS trg_seed_default_departments_on_org_insert ON public.organizations;
    CREATE TRIGGER trg_seed_default_departments_on_org_insert
    AFTER INSERT ON public.organizations
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_seed_default_departments_on_org_insert();
  END IF;
END
$do_trigger$;

