ALTER TABLE public.gl_accounts
  ADD COLUMN IF NOT EXISTS business_type text;

UPDATE public.gl_accounts ga
SET business_type = o.business_type
FROM public.organizations o
WHERE ga.organization_id = o.id
  AND ga.business_type IS DISTINCT FROM o.business_type;

CREATE INDEX IF NOT EXISTS idx_gl_accounts_org_business_type
  ON public.gl_accounts (organization_id, business_type, account_code);

CREATE OR REPLACE FUNCTION public.set_gl_account_org_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    SELECT organization_id INTO NEW.organization_id FROM public.staff WHERE id = auth.uid();
  END IF;
  IF NEW.business_type IS NULL AND NEW.organization_id IS NOT NULL THEN
    SELECT business_type INTO NEW.business_type FROM public.organizations WHERE id = NEW.organization_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_gl_account_business_type ON public.organizations;
CREATE OR REPLACE FUNCTION public.sync_gl_account_business_type()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.business_type IS DISTINCT FROM OLD.business_type THEN
    UPDATE public.gl_accounts SET business_type = NEW.business_type WHERE organization_id = NEW.id;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_sync_gl_account_business_type
AFTER UPDATE OF business_type ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.sync_gl_account_business_type();
