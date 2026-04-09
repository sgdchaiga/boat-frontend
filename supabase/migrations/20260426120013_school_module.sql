-- School module: org flags + core billing/payments tables (per-tenant RLS).

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS school_enable_reports boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS school_enable_fixed_deposit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS school_enable_accounting boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS school_enable_inventory boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS school_enable_purchases boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.school_enable_reports IS
  'When business_type is school, show BOAT Reports in the sidebar.';
COMMENT ON COLUMN public.organizations.school_enable_fixed_deposit IS
  'When business_type is school, show Fixed deposits workspace.';
COMMENT ON COLUMN public.organizations.school_enable_accounting IS
  'When business_type is school, show Accounting (GL, journals, statements).';
COMMENT ON COLUMN public.organizations.school_enable_inventory IS
  'When business_type is school, show Inventory.';
COMMENT ON COLUMN public.organizations.school_enable_purchases IS
  'When business_type is school, show Purchases.';

-- Optional catalog row for subscription/plan pickers (when business_types exists).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'business_types'
  ) AND NOT EXISTS (SELECT 1 FROM public.business_types WHERE code = 'school') THEN
    INSERT INTO public.business_types (code, name, sort_order, is_active)
    VALUES ('school', 'School', 60, true);
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Parents / guardians (multiple students can reference same parent via student_parents)
CREATE TABLE IF NOT EXISTS public.parents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  email text,
  phone text,
  phone_alt text,
  address text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parents_org_name ON public.parents (organization_id, lower(full_name));

CREATE TABLE IF NOT EXISTS public.students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  admission_number text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  class_name text NOT NULL,
  stream text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'left', 'graduated', 'suspended')),
  date_of_birth date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT students_org_admission_unique UNIQUE (organization_id, admission_number)
);

CREATE INDEX IF NOT EXISTS idx_students_org_class ON public.students (organization_id, class_name);
CREATE INDEX IF NOT EXISTS idx_students_org_name ON public.students (organization_id, lower(last_name), lower(first_name));

CREATE TABLE IF NOT EXISTS public.student_parents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  parent_id uuid NOT NULL REFERENCES public.parents(id) ON DELETE CASCADE,
  relationship text,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_parents_unique UNIQUE (student_id, parent_id)
);

CREATE INDEX IF NOT EXISTS idx_student_parents_parent ON public.student_parents (parent_id);

CREATE TABLE IF NOT EXISTS public.fee_structures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  class_name text NOT NULL,
  stream text,
  academic_year text NOT NULL,
  term_name text NOT NULL,
  currency text NOT NULL DEFAULT 'UGX',
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fee_structures_org_class ON public.fee_structures (organization_id, class_name, academic_year, term_name);

CREATE TABLE IF NOT EXISTS public.student_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  fee_structure_id uuid REFERENCES public.fee_structures(id) ON DELETE SET NULL,
  academic_year text NOT NULL,
  term_name text NOT NULL,
  invoice_number text NOT NULL,
  issue_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date,
  subtotal numeric(18, 2) NOT NULL DEFAULT 0,
  discount_amount numeric(18, 2) NOT NULL DEFAULT 0,
  discount_reason text,
  bursary_amount numeric(18, 2) NOT NULL DEFAULT 0,
  scholarship_amount numeric(18, 2) NOT NULL DEFAULT 0,
  total_due numeric(18, 2) NOT NULL DEFAULT 0,
  amount_paid numeric(18, 2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'partial', 'paid', 'cancelled')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_invoices_org_number_unique UNIQUE (organization_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_student_invoices_student ON public.student_invoices (student_id);
CREATE INDEX IF NOT EXISTS idx_student_invoices_status ON public.student_invoices (organization_id, status);

-- Named school_payments / school_receipts to avoid clashing with public.payments (hotel debtor payments).
CREATE TABLE IF NOT EXISTS public.school_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  amount numeric(18, 2) NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('cash', 'mobile_money', 'bank', 'transfer', 'other')),
  reference text,
  paid_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  invoice_allocations jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_school_payments_org_paid ON public.school_payments (organization_id, paid_at);
CREATE INDEX IF NOT EXISTS idx_school_payments_student ON public.school_payments (student_id);

CREATE TABLE IF NOT EXISTS public.school_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  school_payment_id uuid NOT NULL REFERENCES public.school_payments(id) ON DELETE CASCADE,
  receipt_number text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  delivery_channels text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_receipts_org_number_unique UNIQUE (organization_id, receipt_number)
);

CREATE INDEX IF NOT EXISTS idx_school_receipts_payment ON public.school_receipts (school_payment_id);

-- Touch updated_at helpers (reuse pattern from sacco)
CREATE OR REPLACE FUNCTION public.touch_parents_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.touch_students_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.touch_fee_structures_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.touch_student_invoices_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_parents_touch ON public.parents;
CREATE TRIGGER trg_parents_touch BEFORE UPDATE ON public.parents
FOR EACH ROW EXECUTE FUNCTION public.touch_parents_updated_at();

DROP TRIGGER IF EXISTS trg_students_touch ON public.students;
CREATE TRIGGER trg_students_touch BEFORE UPDATE ON public.students
FOR EACH ROW EXECUTE FUNCTION public.touch_students_updated_at();

DROP TRIGGER IF EXISTS trg_fee_structures_touch ON public.fee_structures;
CREATE TRIGGER trg_fee_structures_touch BEFORE UPDATE ON public.fee_structures
FOR EACH ROW EXECUTE FUNCTION public.touch_fee_structures_updated_at();

DROP TRIGGER IF EXISTS trg_student_invoices_touch ON public.student_invoices;
CREATE TRIGGER trg_student_invoices_touch BEFORE UPDATE ON public.student_invoices
FOR EACH ROW EXECUTE FUNCTION public.touch_student_invoices_updated_at();

DROP TRIGGER IF EXISTS trg_set_org_parents ON public.parents;
CREATE TRIGGER trg_set_org_parents BEFORE INSERT ON public.parents
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_students ON public.students;
CREATE TRIGGER trg_set_org_students BEFORE INSERT ON public.students
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_fee_structures ON public.fee_structures;
CREATE TRIGGER trg_set_org_fee_structures BEFORE INSERT ON public.fee_structures
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_student_invoices ON public.student_invoices;
CREATE TRIGGER trg_set_org_student_invoices BEFORE INSERT ON public.student_invoices
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_school_payments ON public.school_payments;
CREATE TRIGGER trg_set_org_school_payments BEFORE INSERT ON public.school_payments
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

DROP TRIGGER IF EXISTS trg_set_org_school_receipts ON public.school_receipts;
CREATE TRIGGER trg_set_org_school_receipts BEFORE INSERT ON public.school_receipts
FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_auth_staff();

-- student_parents: set org from student on insert
CREATE OR REPLACE FUNCTION public.set_student_parents_org_from_student()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE oid uuid;
BEGIN
  SELECT s.organization_id INTO oid FROM public.students s WHERE s.id = NEW.student_id;
  IF oid IS NULL THEN RAISE EXCEPTION 'Student not found'; END IF;
  NEW.organization_id := oid;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_student_parents_org ON public.student_parents;
CREATE TRIGGER trg_student_parents_org BEFORE INSERT ON public.student_parents
FOR EACH ROW EXECUTE FUNCTION public.set_student_parents_org_from_student();

-- RLS
ALTER TABLE public.parents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_parents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_receipts ENABLE ROW LEVEL SECURITY;

DO $pol$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'parents',
    'students',
    'student_parents',
    'fee_structures',
    'student_invoices',
    'school_payments',
    'school_receipts'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_select_same_org', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_write_same_org', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (
        organization_id IS NOT NULL AND organization_id = (
          SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
        )
      )',
      tbl || '_select_same_org',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (
        organization_id IS NOT NULL AND organization_id = (
          SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
        )
      ) WITH CHECK (
        organization_id IS NOT NULL AND organization_id = (
          SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()
        )
      )',
      tbl || '_write_same_org',
      tbl
    );
  END LOOP;
END $pol$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.parents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.students TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_parents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fee_structures TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_invoices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_payments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_receipts TO authenticated;

COMMENT ON TABLE public.parents IS 'School guardians; link many students via student_parents.';
COMMENT ON TABLE public.students IS 'School pupils with class/stream and admission number.';
COMMENT ON TABLE public.student_parents IS 'Many-to-many: students and parents/guardians.';
COMMENT ON TABLE public.fee_structures IS 'Per class/stream term fee lines (JSON line_items).';
COMMENT ON TABLE public.student_invoices IS 'Term invoices with discounts, bursaries, scholarships.';
COMMENT ON TABLE public.school_payments IS 'Fee payments (distinct from hotel public.payments).';
COMMENT ON TABLE public.school_receipts IS 'Receipts issued for school_payments.';
