-- Fix: organizations existed before without full schema (CREATE TABLE IF NOT EXISTS did nothing).
-- Safe to run multiple times.

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS slug text;

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS business_type text;
UPDATE public.organizations SET business_type = 'hotel' WHERE business_type IS NULL;
ALTER TABLE public.organizations ALTER COLUMN business_type SET DEFAULT 'hotel';
ALTER TABLE public.organizations ALTER COLUMN business_type SET NOT NULL;

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS enable_front_desk boolean NOT NULL DEFAULT true;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS enable_billing boolean NOT NULL DEFAULT true;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS enable_pos boolean NOT NULL DEFAULT true;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS enable_inventory boolean NOT NULL DEFAULT true;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS enable_purchases boolean NOT NULL DEFAULT true;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS enable_accounting boolean NOT NULL DEFAULT true;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS enable_reports boolean NOT NULL DEFAULT true;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS enable_admin boolean NOT NULL DEFAULT true;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS organizations_slug_unique
  ON public.organizations (slug)
  WHERE slug IS NOT NULL;

INSERT INTO public.organizations (name, slug, business_type)
SELECT 'Default property', 'default', 'hotel'
WHERE NOT EXISTS (SELECT 1 FROM public.organizations WHERE slug = 'default');

UPDATE public.staff
SET organization_id = (SELECT id FROM public.organizations WHERE slug = 'default' LIMIT 1)
WHERE organization_id IS NULL
  AND EXISTS (SELECT 1 FROM public.organizations WHERE slug = 'default');
