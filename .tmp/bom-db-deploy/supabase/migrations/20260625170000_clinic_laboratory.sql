-- Clinic laboratory: lab orders (requested tests) and per-line results.

CREATE TABLE IF NOT EXISTS public.clinic_lab_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.clinic_patients(id) ON DELETE CASCADE,
  consultation_id uuid REFERENCES public.clinic_consultations(id) ON DELETE SET NULL,
  order_number text NOT NULL,
  status text NOT NULL DEFAULT 'ordered'
    CHECK (status IN ('ordered', 'in_progress', 'completed', 'cancelled')),
  clinical_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, order_number)
);

CREATE INDEX IF NOT EXISTS idx_clinic_lab_orders_org_updated
  ON public.clinic_lab_orders(organization_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_clinic_lab_orders_org_patient
  ON public.clinic_lab_orders(organization_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_clinic_lab_orders_org_status
  ON public.clinic_lab_orders(organization_id, status);

DROP TRIGGER IF EXISTS trg_set_org_clinic_lab_orders ON public.clinic_lab_orders;
CREATE TRIGGER trg_set_org_clinic_lab_orders
BEFORE INSERT ON public.clinic_lab_orders
FOR EACH ROW
EXECUTE FUNCTION public.set_org_id_from_auth_staff();

CREATE OR REPLACE FUNCTION public.touch_clinic_lab_orders_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clinic_lab_orders_touch_updated ON public.clinic_lab_orders;
CREATE TRIGGER trg_clinic_lab_orders_touch_updated
BEFORE UPDATE ON public.clinic_lab_orders
FOR EACH ROW
EXECUTE FUNCTION public.touch_clinic_lab_orders_updated_at();

CREATE OR REPLACE FUNCTION public.clinic_lab_orders_check_refs()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  p_org uuid;
  c_org uuid;
  c_patient uuid;
BEGIN
  SELECT organization_id INTO p_org FROM public.clinic_patients WHERE id = NEW.patient_id;
  IF p_org IS NULL THEN
    RAISE EXCEPTION 'clinic_lab_orders: patient not found';
  END IF;
  IF p_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'clinic_lab_orders: patient organization mismatch';
  END IF;

  IF NEW.consultation_id IS NOT NULL THEN
    SELECT organization_id, patient_id INTO c_org, c_patient
    FROM public.clinic_consultations WHERE id = NEW.consultation_id;
    IF c_org IS NULL THEN
      RAISE EXCEPTION 'clinic_lab_orders: consultation not found';
    END IF;
    IF c_org IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'clinic_lab_orders: consultation organization mismatch';
    END IF;
    IF c_patient IS DISTINCT FROM NEW.patient_id THEN
      RAISE EXCEPTION 'clinic_lab_orders: consultation must belong to the same patient';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clinic_lab_orders_check_refs ON public.clinic_lab_orders;
CREATE TRIGGER trg_clinic_lab_orders_check_refs
BEFORE INSERT OR UPDATE OF patient_id, consultation_id, organization_id ON public.clinic_lab_orders
FOR EACH ROW
EXECUTE FUNCTION public.clinic_lab_orders_check_refs();

CREATE TABLE IF NOT EXISTS public.clinic_lab_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_order_id uuid NOT NULL REFERENCES public.clinic_lab_orders(id) ON DELETE CASCADE,
  test_name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  result_value text,
  result_unit text,
  reference_range text,
  abnormal_flag text CHECK (abnormal_flag IS NULL OR abnormal_flag IN ('normal', 'high', 'low', 'critical')),
  resulted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clinic_lab_order_items_order ON public.clinic_lab_order_items(lab_order_id, sort_order);

CREATE OR REPLACE FUNCTION public.touch_clinic_lab_order_items_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  IF NEW.result_value IS NOT NULL AND trim(NEW.result_value) <> '' AND NEW.resulted_at IS NULL THEN
    NEW.resulted_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clinic_lab_order_items_touch ON public.clinic_lab_order_items;
CREATE TRIGGER trg_clinic_lab_order_items_touch
BEFORE INSERT OR UPDATE ON public.clinic_lab_order_items
FOR EACH ROW
EXECUTE FUNCTION public.touch_clinic_lab_order_items_updated_at();

ALTER TABLE public.clinic_lab_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_lab_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clinic_lab_orders_select_same_org" ON public.clinic_lab_orders;
DROP POLICY IF EXISTS "clinic_lab_orders_write_same_org" ON public.clinic_lab_orders;
DROP POLICY IF EXISTS "clinic_lab_order_items_select_same_org" ON public.clinic_lab_order_items;
DROP POLICY IF EXISTS "clinic_lab_order_items_write_same_org" ON public.clinic_lab_order_items;

CREATE POLICY "clinic_lab_orders_select_same_org"
  ON public.clinic_lab_orders FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

CREATE POLICY "clinic_lab_orders_write_same_org"
  ON public.clinic_lab_orders FOR ALL
  TO authenticated
  USING (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IS NOT NULL AND organization_id = (
      SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
    )
  );

CREATE POLICY "clinic_lab_order_items_select_same_org"
  ON public.clinic_lab_order_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.clinic_lab_orders o
      WHERE o.id = lab_order_id
        AND o.organization_id = (
          SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
        )
    )
  );

CREATE POLICY "clinic_lab_order_items_write_same_org"
  ON public.clinic_lab_order_items FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.clinic_lab_orders o
      WHERE o.id = lab_order_id
        AND o.organization_id = (
          SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.clinic_lab_orders o
      WHERE o.id = lab_order_id
        AND o.organization_id = (
          SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
        )
    )
  );

COMMENT ON TABLE public.clinic_lab_orders IS 'Laboratory requisitions per clinic patient (optional link to consultation).';
COMMENT ON TABLE public.clinic_lab_order_items IS 'Requested tests and captured result values / reference ranges.';
