-- Clinic: link retail invoices to clinic_patients (optional; mutually exclusive with retail_customers / hotel_customers).

ALTER TABLE public.retail_invoices
  ADD COLUMN IF NOT EXISTS clinic_patient_id uuid REFERENCES public.clinic_patients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_retail_invoices_clinic_patient
  ON public.retail_invoices (clinic_patient_id)
  WHERE clinic_patient_id IS NOT NULL;

ALTER TABLE public.retail_invoices
  DROP CONSTRAINT IF EXISTS retail_invoices_customer_or_property_customer_chk;

ALTER TABLE public.retail_invoices
  ADD CONSTRAINT retail_invoices_single_counterparty_chk
  CHECK (
    (CASE WHEN customer_id IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN property_customer_id IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN clinic_patient_id IS NOT NULL THEN 1 ELSE 0 END)
    <= 1
  );

CREATE OR REPLACE FUNCTION public.retail_invoices_check_clinic_patient_org()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  p_org uuid;
BEGIN
  IF NEW.clinic_patient_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT organization_id INTO p_org FROM public.clinic_patients WHERE id = NEW.clinic_patient_id;
  IF p_org IS NULL THEN
    RAISE EXCEPTION 'retail_invoices: clinic patient not found';
  END IF;
  IF p_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'retail_invoices: clinic patient organization mismatch';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_retail_invoices_check_clinic_patient ON public.retail_invoices;
CREATE TRIGGER trg_retail_invoices_check_clinic_patient
BEFORE INSERT OR UPDATE OF clinic_patient_id, organization_id ON public.retail_invoices
FOR EACH ROW
EXECUTE FUNCTION public.retail_invoices_check_clinic_patient_org();

COMMENT ON COLUMN public.retail_invoices.clinic_patient_id IS
  'Clinic/pharmacy: links invoice to clinic_patients.id. Use customer_id for retail_customers; property_customer_id for hotel_customers.';
