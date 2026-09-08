-- Accounting-practice workspace: client work stays separate from the firm's own books.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'business_types') THEN
    INSERT INTO public.business_types (code, name, is_active, sort_order)
    VALUES ('accounting_practice', 'Accounting Practice', true, 45)
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, is_active = true;
  END IF;
END $$;

INSERT INTO storage.buckets (id, name, public)
VALUES ('practice-vault', 'practice-vault', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS practice_vault_same_org ON storage.objects;
CREATE POLICY practice_vault_same_org ON storage.objects FOR ALL TO authenticated
USING (
  bucket_id = 'practice-vault'
  AND (
    public.is_platform_admin()
    OR (storage.foldername(name))[1] = (SELECT s.organization_id::text FROM public.staff s WHERE s.id = auth.uid())
  )
)
WITH CHECK (
  bucket_id = 'practice-vault'
  AND (
    public.is_platform_admin()
    OR (storage.foldername(name))[1] = (SELECT s.organization_id::text FROM public.staff s WHERE s.id = auth.uid())
  )
);

CREATE TABLE IF NOT EXISTS public.practice_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  contact_name text,
  email text,
  phone text,
  tax_id text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.practice_engagements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.practice_clients(id) ON DELETE CASCADE,
  title text NOT NULL,
  service_type text NOT NULL DEFAULT 'Bookkeeping',
  period_start date,
  period_end date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'review', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.practice_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.practice_clients(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  storage_path text,
  category text NOT NULL DEFAULT 'Other',
  notes text,
  uploaded_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.practice_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.practice_clients(id) ON DELETE CASCADE,
  title text NOT NULL,
  due_date date,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.practice_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.practice_clients(id) ON DELETE CASCADE,
  description text NOT NULL,
  invoice_date date NOT NULL DEFAULT current_date,
  due_date date,
  amount numeric(18,2) NOT NULL CHECK (amount >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'overdue')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.practice_reconciliation_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.practice_clients(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('cashbook', 'statement')),
  line_date date NOT NULL,
  description text NOT NULL DEFAULT '',
  reference text,
  amount numeric(18,2) NOT NULL CHECK (amount <> 0),
  source_file text,
  match_group_id uuid,
  imported_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_practice_clients_org ON public.practice_clients (organization_id, name);
CREATE INDEX IF NOT EXISTS idx_practice_reconciliation_client_date ON public.practice_reconciliation_lines (client_id, line_date DESC);

ALTER TABLE public.practice_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_engagements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_reconciliation_lines ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'practice_clients', 'practice_engagements', 'practice_documents',
    'practice_tasks', 'practice_invoices', 'practice_reconciliation_lines'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_same_org', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
       USING (public.is_platform_admin() OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))
       WITH CHECK (public.is_platform_admin() OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))',
      table_name || '_same_org', table_name
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', table_name);
  END LOOP;
END $$;
