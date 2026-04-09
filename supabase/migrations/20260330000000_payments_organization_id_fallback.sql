-- Incoming payments: ensure organization_id is set when the generic auth.staff lookup misses
-- (e.g. timing, or when deriving org from processed_by / stay is more reliable).

CREATE OR REPLACE FUNCTION public.set_org_id_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.organization_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT s.organization_id INTO NEW.organization_id
  FROM public.staff s
  WHERE s.id = auth.uid();

  IF NEW.organization_id IS NULL AND NEW.processed_by IS NOT NULL THEN
    SELECT s.organization_id INTO NEW.organization_id
    FROM public.staff s
    WHERE s.id = NEW.processed_by;
  END IF;

  IF NEW.organization_id IS NULL AND NEW.stay_id IS NOT NULL THEN
    SELECT st.organization_id INTO NEW.organization_id
    FROM public.stays st
    WHERE st.id = NEW.stay_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_org_payments ON public.payments;
CREATE TRIGGER trg_set_org_payments
BEFORE INSERT ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_payments();

-- Backfill rows still missing organization_id (e.g. retail/POS rows with processed_by or stay-linked)
UPDATE public.payments p
SET organization_id = s.organization_id
FROM public.staff s
WHERE p.organization_id IS NULL
  AND p.processed_by IS NOT NULL
  AND s.id = p.processed_by
  AND s.organization_id IS NOT NULL;

UPDATE public.payments p
SET organization_id = st.organization_id
FROM public.stays st
WHERE p.organization_id IS NULL
  AND p.stay_id IS NOT NULL
  AND st.id = p.stay_id
  AND st.organization_id IS NOT NULL;
