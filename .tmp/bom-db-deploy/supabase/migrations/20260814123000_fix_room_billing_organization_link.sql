-- Room reconciliation must not lose folio charges when the creator could not be
-- resolved to a staff record. The stay is the authoritative organization link.

UPDATE public.billing b
SET organization_id = s.organization_id
FROM public.stays s
WHERE b.stay_id = s.id
  AND b.organization_id IS NULL
  AND s.organization_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_org_id_billing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stay_id IS NOT NULL THEN
    SELECT s.organization_id INTO NEW.organization_id
    FROM public.stays s
    WHERE s.id = NEW.stay_id;
  END IF;

  IF NEW.organization_id IS NULL AND NEW.created_by IS NOT NULL THEN
    SELECT st.organization_id INTO NEW.organization_id
    FROM public.staff st
    WHERE st.id = NEW.created_by;
  END IF;

  IF NEW.organization_id IS NULL THEN
    SELECT st.organization_id INTO NEW.organization_id
    FROM public.staff st
    WHERE st.id = auth.uid();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_org_billing ON public.billing;
CREATE TRIGGER trg_set_org_billing
BEFORE INSERT OR UPDATE OF stay_id, created_by, organization_id ON public.billing
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_billing();

-- Repair mismatches too, so room charges cannot be hidden from their stay's hotel.
UPDATE public.billing b
SET organization_id = s.organization_id
FROM public.stays s
WHERE b.stay_id = s.id
  AND b.organization_id IS DISTINCT FROM s.organization_id
  AND s.organization_id IS NOT NULL;
