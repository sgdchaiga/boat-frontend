-- Client document requests and support service-desk controls.

CREATE TABLE IF NOT EXISTS public.practice_document_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.practice_clients(id) ON DELETE CASCADE,
  engagement_id uuid REFERENCES public.practice_engagements(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'Other',
  requested_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  responsible_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  requested_on date NOT NULL DEFAULT current_date,
  due_date date,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('draft','requested','partially_received','received','accepted','rejected','waived')),
  client_response text,
  received_document_id uuid REFERENCES public.practice_documents(id) ON DELETE SET NULL,
  received_at timestamptz,
  reviewed_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.practice_support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.practice_clients(id) ON DELETE CASCADE,
  engagement_id uuid REFERENCES public.practice_engagements(id) ON DELETE SET NULL,
  ticket_number text NOT NULL,
  module text,
  category text NOT NULL DEFAULT 'General support',
  title text NOT NULL,
  description text NOT NULL,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent','critical')),
  business_impact text,
  assigned_to uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  reported_by_name text,
  reported_at timestamptz NOT NULL DEFAULT now(),
  response_due_at timestamptz,
  resolution_due_at timestamptz,
  first_responded_at timestamptz,
  resolved_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','in_progress','waiting_for_client','escalated','resolved','closed')),
  chargeable boolean NOT NULL DEFAULT false,
  time_spent_hours numeric(12,2) NOT NULL DEFAULT 0,
  root_cause text,
  resolution text,
  client_confirmed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, ticket_number)
);

CREATE INDEX IF NOT EXISTS idx_practice_document_requests_due ON public.practice_document_requests (organization_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_practice_document_requests_engagement ON public.practice_document_requests (engagement_id, status);
CREATE INDEX IF NOT EXISTS idx_practice_support_tickets_queue ON public.practice_support_tickets (organization_id, status, priority, resolution_due_at);
CREATE INDEX IF NOT EXISTS idx_practice_support_tickets_assignee ON public.practice_support_tickets (assigned_to, status, resolution_due_at);

ALTER TABLE public.practice_document_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_support_tickets ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['practice_document_requests', 'practice_support_tickets'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_same_org', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_platform_admin() OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())) WITH CHECK (public.is_platform_admin() OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))',
      table_name || '_same_org', table_name
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', table_name);
  END LOOP;
END $$;
