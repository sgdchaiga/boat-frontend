-- Reusable engagement workflows for the Professional Services MVP.

CREATE TABLE IF NOT EXISTS public.practice_workflow_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  service_type text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS public.practice_workflow_template_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.practice_workflow_templates(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  sequence_no integer NOT NULL,
  due_offset_days integer NOT NULL DEFAULT 0,
  estimated_hours numeric(12,2) NOT NULL DEFAULT 0,
  responsible_role text,
  requires_review boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, sequence_no)
);

CREATE INDEX IF NOT EXISTS idx_practice_workflow_templates_org ON public.practice_workflow_templates (organization_id, is_active, name);
CREATE INDEX IF NOT EXISTS idx_practice_template_tasks_template ON public.practice_workflow_template_tasks (template_id, sequence_no);

ALTER TABLE public.practice_workflow_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_workflow_template_tasks ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['practice_workflow_templates', 'practice_workflow_template_tasks'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_same_org', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_platform_admin() OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid())) WITH CHECK (public.is_platform_admin() OR organization_id = (SELECT s.organization_id FROM public.staff s WHERE s.id = auth.uid()))',
      table_name || '_same_org', table_name
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', table_name);
  END LOOP;
END $$;

INSERT INTO public.practice_workflow_templates (organization_id, name, description, service_type)
SELECT o.id, seed.name, seed.description, seed.service_type
FROM public.organizations o
CROSS JOIN (VALUES
  ('New client implementation', 'Setup, migration, testing, training, go-live and post-implementation review.', 'Implementation'),
  ('Data migration', 'Receive, validate, map, import and reconcile client data.', 'Data migration'),
  ('Training', 'Plan, deliver, assess and obtain client training sign-off.', 'Training'),
  ('Monthly support', 'Recurring service, subscription and client follow-up controls.', 'Support'),
  ('Accounting assignment', 'Document collection through processing, review and final reporting.', 'Accounting')
) AS seed(name, description, service_type)
ON CONFLICT (organization_id, name) DO NOTHING;

INSERT INTO public.practice_workflow_template_tasks
  (organization_id, template_id, title, sequence_no, due_offset_days, estimated_hours, responsible_role, requires_review)
SELECT t.organization_id, t.id, seed.title, seed.sequence_no, seed.due_offset_days, seed.estimated_hours, seed.responsible_role, seed.requires_review
FROM public.practice_workflow_templates t
JOIN (VALUES
  ('New client implementation', 'Conduct needs assessment', 1, 0, 3, 'manager', true),
  ('New client implementation', 'Confirm modules, users and signed contract', 2, 2, 2, 'manager', true),
  ('New client implementation', 'Configure organisation, roles and settings', 3, 5, 8, 'consultant', false),
  ('New client implementation', 'Import opening and historical information', 4, 10, 12, 'consultant', true),
  ('New client implementation', 'Reconcile migrated balances', 5, 14, 8, 'reviewer', true),
  ('New client implementation', 'Conduct user acceptance testing', 6, 18, 5, 'consultant', true),
  ('New client implementation', 'Train users and obtain sign-off', 7, 21, 8, 'trainer', true),
  ('New client implementation', 'Obtain go-live approval', 8, 24, 2, 'manager', true),
  ('New client implementation', 'Complete post-implementation review', 9, 35, 3, 'manager', true),
  ('Data migration', 'Send migration template', 1, 0, 1, 'consultant', false),
  ('Data migration', 'Receive and validate client data', 2, 3, 4, 'consultant', true),
  ('Data migration', 'Clean and map records', 3, 7, 8, 'consultant', true),
  ('Data migration', 'Import and reconcile test data', 4, 12, 10, 'consultant', true),
  ('Data migration', 'Obtain client confirmation', 5, 15, 2, 'manager', true),
  ('Data migration', 'Perform final import and lock balances', 6, 18, 6, 'consultant', true),
  ('Training', 'Identify user groups and prepare programme', 1, 0, 3, 'trainer', true),
  ('Training', 'Confirm venue, equipment and attendance', 2, 3, 2, 'trainer', false),
  ('Training', 'Conduct practical training and assessment', 3, 7, 8, 'trainer', false),
  ('Training', 'Record questions and obtain sign-off', 4, 8, 2, 'manager', true),
  ('Monthly support', 'Review open tickets and unresolved issues', 1, 0, 2, 'support', false),
  ('Monthly support', 'Review hosting, backup and user activity', 2, 5, 2, 'support', true),
  ('Monthly support', 'Confirm subscription status', 3, 10, 1, 'manager', false),
  ('Monthly support', 'Conduct client follow-up', 4, 20, 2, 'manager', false),
  ('Monthly support', 'Prepare monthly service summary', 5, 28, 2, 'support', true),
  ('Accounting assignment', 'Request and review client documents', 1, 0, 3, 'accountant', false),
  ('Accounting assignment', 'Process transactions and reconciliations', 2, 5, 12, 'accountant', true),
  ('Accounting assignment', 'Post adjustments and prepare reports', 3, 12, 8, 'accountant', true),
  ('Accounting assignment', 'Conduct managerial review', 4, 17, 4, 'manager', true),
  ('Accounting assignment', 'Clear comments and issue final reports', 5, 21, 5, 'accountant', true)
) AS seed(template_name, title, sequence_no, due_offset_days, estimated_hours, responsible_role, requires_review)
  ON seed.template_name = t.name
ON CONFLICT (template_id, sequence_no) DO NOTHING;
