-- Rich client profiles, contacts and cross-workspace activity history.

ALTER TABLE public.practice_clients
  ADD COLUMN IF NOT EXISTS trading_name text,
  ADD COLUMN IF NOT EXISTS client_type text,
  ADD COLUMN IF NOT EXISTS registration_number text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS branches text,
  ADD COLUMN IF NOT EXISTS modules_used text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS hosting_arrangement text,
  ADD COLUMN IF NOT EXISTS contract_start_date date,
  ADD COLUMN IF NOT EXISTS contract_end_date date,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.practice_client_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.practice_clients(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  job_title text,
  email text,
  phone text,
  is_primary boolean NOT NULL DEFAULT false,
  is_authorized_representative boolean NOT NULL DEFAULT false,
  can_approve_deliverables boolean NOT NULL DEFAULT false,
  can_view_billing boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.practice_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.practice_clients(id) ON DELETE CASCADE,
  engagement_id uuid REFERENCES public.practice_engagements(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  performed_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_practice_contacts_client ON public.practice_client_contacts (client_id, is_primary DESC, full_name);
CREATE INDEX IF NOT EXISTS idx_practice_activity_client_time ON public.practice_activity_log (client_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_practice_activity_engagement_time ON public.practice_activity_log (engagement_id, occurred_at DESC);

ALTER TABLE public.practice_client_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_activity_log ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['practice_client_contacts', 'practice_activity_log'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_same_org', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_platform_admin() OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())) WITH CHECK (public.is_platform_admin() OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))',
      table_name || '_same_org', table_name
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', table_name);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.practice_capture_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_client_id uuid;
  v_engagement_id uuid;
  v_summary text;
BEGIN
  v_client_id := CASE WHEN TG_TABLE_NAME = 'retail_invoices' THEN NEW.practice_client_id ELSE NEW.client_id END;
  v_engagement_id := CASE
    WHEN TG_TABLE_NAME = 'practice_engagements' THEN NEW.id
    WHEN TG_TABLE_NAME = 'retail_invoices' THEN NEW.practice_engagement_id
    ELSE NEW.engagement_id
  END;
  v_summary := CASE
    WHEN TG_TABLE_NAME = 'practice_engagements' THEN COALESCE(NEW.title, 'Engagement')
    WHEN TG_TABLE_NAME = 'practice_tasks' THEN COALESCE(NEW.title, 'Task')
    WHEN TG_TABLE_NAME = 'practice_document_requests' THEN COALESCE(NEW.title, 'Document request')
    WHEN TG_TABLE_NAME = 'practice_support_tickets' THEN COALESCE(NEW.ticket_number || ': ' || NEW.title, NEW.title, 'Support ticket')
    WHEN TG_TABLE_NAME = 'retail_invoices' THEN COALESCE(NEW.invoice_number, 'Invoice')
    ELSE TG_TABLE_NAME
  END;
  INSERT INTO public.practice_activity_log (organization_id, client_id, engagement_id, entity_type, entity_id, action, summary, details, performed_by)
  VALUES (NEW.organization_id, v_client_id, v_engagement_id, TG_TABLE_NAME, NEW.id, lower(TG_OP), v_summary,
    jsonb_strip_nulls(jsonb_build_object('status', to_jsonb(NEW)->>'status', 'due_date', to_jsonb(NEW)->>'due_date', 'priority', to_jsonb(NEW)->>'priority')),
    auth.uid());
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_practice_engagement_activity ON public.practice_engagements;
CREATE TRIGGER trg_practice_engagement_activity AFTER INSERT OR UPDATE ON public.practice_engagements FOR EACH ROW EXECUTE FUNCTION public.practice_capture_activity();
DROP TRIGGER IF EXISTS trg_practice_task_activity ON public.practice_tasks;
CREATE TRIGGER trg_practice_task_activity AFTER INSERT OR UPDATE ON public.practice_tasks FOR EACH ROW EXECUTE FUNCTION public.practice_capture_activity();
DROP TRIGGER IF EXISTS trg_practice_document_request_activity ON public.practice_document_requests;
CREATE TRIGGER trg_practice_document_request_activity AFTER INSERT OR UPDATE ON public.practice_document_requests FOR EACH ROW EXECUTE FUNCTION public.practice_capture_activity();
DROP TRIGGER IF EXISTS trg_practice_support_ticket_activity ON public.practice_support_tickets;
CREATE TRIGGER trg_practice_support_ticket_activity AFTER INSERT OR UPDATE ON public.practice_support_tickets FOR EACH ROW EXECUTE FUNCTION public.practice_capture_activity();
DROP TRIGGER IF EXISTS trg_practice_invoice_activity ON public.retail_invoices;
CREATE TRIGGER trg_practice_invoice_activity AFTER INSERT OR UPDATE ON public.retail_invoices FOR EACH ROW
WHEN (NEW.practice_engagement_id IS NOT NULL) EXECUTE FUNCTION public.practice_capture_activity();
