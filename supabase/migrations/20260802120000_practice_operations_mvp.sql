-- Professional-services operations MVP. Extends the existing practice workspace
-- without creating a second customer, staff, invoice, receipt, or ledger system.

ALTER TABLE public.practice_clients
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS industry text,
  ADD COLUMN IF NOT EXISTS relationship_manager_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS renewal_date date,
  ADD COLUMN IF NOT EXISTS risk_level text NOT NULL DEFAULT 'normal';

ALTER TABLE public.practice_engagements DROP CONSTRAINT IF EXISTS practice_engagements_status_check;
ALTER TABLE public.practice_engagements
  ADD COLUMN IF NOT EXISTS engagement_number text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS scope text,
  ADD COLUMN IF NOT EXISTS exclusions text,
  ADD COLUMN IF NOT EXISTS responsible_manager_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS delay_owner text,
  ADD COLUMN IF NOT EXISTS budgeted_hours numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS budgeted_staff_cost numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS budgeted_expenses numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS contract_value numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS billing_arrangement text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE public.practice_engagements
  ADD CONSTRAINT practice_engagements_status_check CHECK (status IN ('not_started','waiting_for_client','in_progress','under_review','ready_for_delivery','delivered','invoiced','completed','closed','open','review')),
  ADD CONSTRAINT practice_engagements_priority_check CHECK (priority IN ('low','normal','high','urgent')),
  ADD CONSTRAINT practice_engagements_delay_owner_check CHECK (delay_owner IS NULL OR delay_owner IN ('boat','client','external'));

UPDATE public.practice_engagements SET status = 'not_started' WHERE status = 'open';
UPDATE public.practice_engagements SET status = 'under_review' WHERE status = 'review';

ALTER TABLE public.practice_tasks DROP CONSTRAINT IF EXISTS practice_tasks_status_check;
ALTER TABLE public.practice_tasks DROP CONSTRAINT IF EXISTS practice_tasks_priority_check;
ALTER TABLE public.practice_tasks
  ADD COLUMN IF NOT EXISTS engagement_id uuid REFERENCES public.practice_engagements(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewer_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS planned_start date,
  ADD COLUMN IF NOT EXISTS estimated_hours numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_hours numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blocker text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE public.practice_tasks
  ADD CONSTRAINT practice_tasks_status_check CHECK (status IN ('not_started','waiting_for_client','in_progress','under_review','returned','completed','open')),
  ADD CONSTRAINT practice_tasks_priority_check CHECK (priority IN ('low','normal','high','urgent'));
UPDATE public.practice_tasks SET status = 'not_started' WHERE status = 'open';

ALTER TABLE public.practice_documents
  ADD COLUMN IF NOT EXISTS engagement_id uuid REFERENCES public.practice_engagements(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS document_status text NOT NULL DEFAULT 'working',
  ADD COLUMN IF NOT EXISTS expires_on date;

CREATE TABLE IF NOT EXISTS public.practice_engagement_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  engagement_id uuid NOT NULL REFERENCES public.practice_engagements(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  assignment_role text NOT NULL DEFAULT 'team_member',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (engagement_id, staff_id)
);

CREATE TABLE IF NOT EXISTS public.practice_time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  engagement_id uuid NOT NULL REFERENCES public.practice_engagements(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.practice_tasks(id) ON DELETE SET NULL,
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
  work_date date NOT NULL DEFAULT current_date,
  hours numeric(8,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  description text NOT NULL,
  billable boolean NOT NULL DEFAULT true,
  approval_status text NOT NULL DEFAULT 'draft' CHECK (approval_status IN ('draft','submitted','approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_practice_engagements_org_status_due ON public.practice_engagements (organization_id, status, due_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_practice_engagement_number_org ON public.practice_engagements (organization_id, engagement_number) WHERE engagement_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_practice_tasks_assignee_status_due ON public.practice_tasks (organization_id, assigned_to, status, due_date);
CREATE INDEX IF NOT EXISTS idx_practice_tasks_engagement ON public.practice_tasks (engagement_id, due_date);
CREATE INDEX IF NOT EXISTS idx_practice_time_engagement_date ON public.practice_time_entries (engagement_id, work_date DESC);

ALTER TABLE public.practice_engagement_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_time_entries ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['practice_engagement_staff', 'practice_time_entries'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_same_org', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_platform_admin() OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())) WITH CHECK (public.is_platform_admin() OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))',
      table_name || '_same_org', table_name
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', table_name);
  END LOOP;
END $$;
