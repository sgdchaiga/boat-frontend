-- organization_subscriptions: ensure updated_at exists and is maintained.
-- Older DBs may have been created via CREATE TABLE IF NOT EXISTS before this column
-- existed, so the column was never added — PostgREST then errors on PATCH including updated_at.

ALTER TABLE public.organization_subscriptions
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.organization_subscriptions_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_organization_subscriptions_set_updated_at ON public.organization_subscriptions;
CREATE TRIGGER trg_organization_subscriptions_set_updated_at
  BEFORE UPDATE ON public.organization_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.organization_subscriptions_touch_updated_at();
