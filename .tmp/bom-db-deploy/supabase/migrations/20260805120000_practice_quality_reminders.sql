-- Phase 2: quality review, client sign-offs, satisfaction and due reminders.

CREATE TABLE IF NOT EXISTS public.practice_review_notes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 engagement_id uuid NOT NULL REFERENCES public.practice_engagements(id) ON DELETE CASCADE, task_id uuid REFERENCES public.practice_tasks(id) ON DELETE CASCADE,
 note text NOT NULL, severity text NOT NULL DEFAULT 'normal' CHECK (severity IN ('low','normal','high','critical')),
 raised_by uuid REFERENCES public.staff(id) ON DELETE SET NULL, assigned_to uuid REFERENCES public.staff(id) ON DELETE SET NULL,
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','responded','cleared','reopened')),
 staff_response text, correction_evidence text, responded_at timestamptz, cleared_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
 cleared_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.practice_client_signoffs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 client_id uuid NOT NULL REFERENCES public.practice_clients(id) ON DELETE CASCADE, engagement_id uuid NOT NULL REFERENCES public.practice_engagements(id) ON DELETE CASCADE,
 signoff_type text NOT NULL, title text NOT NULL, status text NOT NULL DEFAULT 'requested' CHECK (status IN ('draft','requested','approved','rejected')),
 requested_by uuid REFERENCES public.staff(id) ON DELETE SET NULL, requested_at timestamptz NOT NULL DEFAULT now(),
 decided_by_contact_id uuid REFERENCES public.practice_client_contacts(id) ON DELETE SET NULL, decided_at timestamptz, client_notes text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.practice_client_satisfaction (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 client_id uuid NOT NULL REFERENCES public.practice_clients(id) ON DELETE CASCADE, engagement_id uuid REFERENCES public.practice_engagements(id) ON DELETE SET NULL,
 score integer NOT NULL CHECK (score BETWEEN 1 AND 5), timeliness_score integer CHECK (timeliness_score BETWEEN 1 AND 5),
 quality_score integer CHECK (quality_score BETWEEN 1 AND 5), communication_score integer CHECK (communication_score BETWEEN 1 AND 5),
 comments text, recorded_by uuid REFERENCES public.staff(id) ON DELETE SET NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.practice_reminders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 source_type text NOT NULL, source_id uuid NOT NULL, title text NOT NULL, due_date date NOT NULL, assigned_to uuid REFERENCES public.staff(id) ON DELETE SET NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','acknowledged','dismissed')),
 created_at timestamptz NOT NULL DEFAULT now(), acknowledged_at timestamptz, UNIQUE (organization_id,source_type,source_id,due_date)
);
CREATE INDEX IF NOT EXISTS idx_practice_review_queue ON public.practice_review_notes(organization_id,status,assigned_to,created_at);
CREATE INDEX IF NOT EXISTS idx_practice_signoffs_queue ON public.practice_client_signoffs(organization_id,status,requested_at);
CREATE INDEX IF NOT EXISTS idx_practice_satisfaction_client ON public.practice_client_satisfaction(client_id,recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_practice_reminders_due ON public.practice_reminders(organization_id,status,due_date,assigned_to);
ALTER TABLE public.practice_review_notes ENABLE ROW LEVEL SECURITY;ALTER TABLE public.practice_client_signoffs ENABLE ROW LEVEL SECURITY;ALTER TABLE public.practice_client_satisfaction ENABLE ROW LEVEL SECURITY;ALTER TABLE public.practice_reminders ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE table_name text; BEGIN FOREACH table_name IN ARRAY ARRAY['practice_review_notes','practice_client_signoffs','practice_client_satisfaction','practice_reminders'] LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',table_name||'_same_org',table_name);EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_platform_admin() OR organization_id=(SELECT s.organization_id FROM public.staff s WHERE s.id=auth.uid())) WITH CHECK (public.is_platform_admin() OR organization_id=(SELECT s.organization_id FROM public.staff s WHERE s.id=auth.uid()))',table_name||'_same_org',table_name);EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated',table_name);END LOOP;END $$;

CREATE OR REPLACE FUNCTION public.practice_generate_due_reminders()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid; v_count integer:=0; v_rows integer:=0;BEGIN SELECT organization_id INTO v_org FROM public.staff WHERE id=auth.uid();IF v_org IS NULL AND NOT public.is_platform_admin() THEN RAISE EXCEPTION 'No organization context';END IF;
 INSERT INTO public.practice_reminders(organization_id,source_type,source_id,title,due_date,assigned_to)
 SELECT organization_id,'task',id,'Task due: '||title,due_date,assigned_to FROM public.practice_tasks WHERE organization_id=v_org AND due_date BETWEEN current_date-30 AND current_date+14 AND status<>'completed'
 ON CONFLICT DO NOTHING;GET DIAGNOSTICS v_rows=ROW_COUNT;v_count:=v_count+v_rows;
 INSERT INTO public.practice_reminders(organization_id,source_type,source_id,title,due_date,assigned_to)
 SELECT organization_id,'document_request',id,'Client document due: '||title,due_date,responsible_staff_id FROM public.practice_document_requests WHERE organization_id=v_org AND due_date BETWEEN current_date-30 AND current_date+14 AND status NOT IN ('accepted','waived') ON CONFLICT DO NOTHING;GET DIAGNOSTICS v_rows=ROW_COUNT;v_count:=v_count+v_rows;
 INSERT INTO public.practice_reminders(organization_id,source_type,source_id,title,due_date,assigned_to)
 SELECT organization_id,'proposal',id,'Proposal expires: '||proposal_number,valid_until,prepared_by FROM public.practice_proposals WHERE organization_id=v_org AND valid_until BETWEEN current_date AND current_date+14 AND status IN ('approved','sent') ON CONFLICT DO NOTHING;GET DIAGNOSTICS v_rows=ROW_COUNT;v_count:=v_count+v_rows;
 INSERT INTO public.practice_reminders(organization_id,source_type,source_id,title,due_date,assigned_to)
 SELECT organization_id,'renewal',id,'Subscription renewal: '||name,renewal_date,relationship_manager_id FROM public.practice_clients WHERE organization_id=v_org AND renewal_date BETWEEN current_date AND current_date+30 AND subscription_status NOT IN ('cancelled','not_applicable') ON CONFLICT DO NOTHING;GET DIAGNOSTICS v_rows=ROW_COUNT;v_count:=v_count+v_rows;RETURN v_count;END $$;
GRANT EXECUTE ON FUNCTION public.practice_generate_due_reminders() TO authenticated;
