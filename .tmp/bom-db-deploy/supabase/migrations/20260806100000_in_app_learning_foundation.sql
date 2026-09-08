-- BOAT in-app learning foundation: global/organization help, tours and user progress.
CREATE TABLE IF NOT EXISTS public.help_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  page_key text NOT NULL,
  module_key text NOT NULL,
  role_keys text[] NOT NULL DEFAULT '{}',
  title text NOT NULL,
  short_description text NOT NULL,
  instructions jsonb NOT NULL DEFAULT '[]'::jsonb,
  common_mistakes jsonb NOT NULL DEFAULT '[]'::jsonb,
  related_guidance jsonb NOT NULL DEFAULT '[]'::jsonb,
  troubleshooting jsonb NOT NULL DEFAULT '[]'::jsonb,
  media_url text,
  media_type text CHECK (media_type IS NULL OR media_type IN ('gif','mp4','web')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (organization_id, page_key, version)
);

CREATE TABLE IF NOT EXISTS public.help_tooltips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  page_key text NOT NULL,
  field_key text NOT NULL,
  role_keys text[] NOT NULL DEFAULT '{}',
  term text NOT NULL,
  explanation text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE NULLS NOT DISTINCT (organization_id, page_key, field_key)
);

CREATE TABLE IF NOT EXISTS public.guided_tours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  page_key text NOT NULL,
  role_keys text[] NOT NULL DEFAULT '{}',
  title text NOT NULL,
  description text,
  version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE NULLS NOT DISTINCT (organization_id, page_key, version)
);

CREATE TABLE IF NOT EXISTS public.guided_tour_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id uuid NOT NULL REFERENCES public.guided_tours(id) ON DELETE CASCADE,
  step_order integer NOT NULL CHECK (step_order > 0),
  target_selector text,
  title text NOT NULL,
  body text NOT NULL,
  placement text NOT NULL DEFAULT 'auto' CHECK (placement IN ('auto','top','right','bottom','left')),
  UNIQUE (tour_id, step_order)
);

CREATE TABLE IF NOT EXISTS public.training_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  module_key text NOT NULL,
  page_key text NOT NULL,
  role_keys text[] NOT NULL DEFAULT '{}',
  title text NOT NULL,
  instructions text NOT NULL,
  success_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  task_order integer NOT NULL DEFAULT 1,
  points integer NOT NULL DEFAULT 10 CHECK (points >= 0),
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE NULLS NOT DISTINCT (organization_id,module_key,page_key,title)
);

CREATE TABLE IF NOT EXISTS public.user_training_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content_type text NOT NULL CHECK (content_type IN ('introduction','tour','task','article')),
  content_key text NOT NULL,
  status text NOT NULL DEFAULT 'started' CHECK (status IN ('started','completed','dismissed')),
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, content_type, content_key)
);

CREATE INDEX IF NOT EXISTS help_articles_lookup_idx ON public.help_articles(module_key,page_key,is_active);
CREATE INDEX IF NOT EXISTS help_tooltips_lookup_idx ON public.help_tooltips(page_key,field_key,is_active);
CREATE INDEX IF NOT EXISTS training_progress_user_idx ON public.user_training_progress(user_id,organization_id,status);

ALTER TABLE public.help_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.help_tooltips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guided_tours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guided_tour_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_training_progress ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.learning_user_can_manage()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.is_platform_admin() OR EXISTS (
    SELECT 1 FROM public.staff
    WHERE id=auth.uid() AND role IN ('admin','manager','super_admin','owner')
  );
$$;
REVOKE ALL ON FUNCTION public.learning_user_can_manage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_user_can_manage() TO authenticated;

DROP POLICY IF EXISTS help_articles_read ON public.help_articles;
CREATE POLICY help_articles_read ON public.help_articles FOR SELECT TO authenticated
USING (is_active AND (organization_id IS NULL OR public.user_is_member_of_org(organization_id) OR public.is_platform_admin()));
DROP POLICY IF EXISTS help_articles_org_admin_write ON public.help_articles;
CREATE POLICY help_articles_org_admin_write ON public.help_articles FOR ALL TO authenticated
USING (organization_id IS NOT NULL AND (public.is_platform_admin() OR (public.user_is_member_of_org(organization_id) AND public.learning_user_can_manage())))
WITH CHECK (organization_id IS NOT NULL AND (public.is_platform_admin() OR (public.user_is_member_of_org(organization_id) AND public.learning_user_can_manage())));

DROP POLICY IF EXISTS help_tooltips_read ON public.help_tooltips;
CREATE POLICY help_tooltips_read ON public.help_tooltips FOR SELECT TO authenticated
USING (is_active AND (organization_id IS NULL OR public.user_is_member_of_org(organization_id) OR public.is_platform_admin()));
DROP POLICY IF EXISTS help_tooltips_org_admin_write ON public.help_tooltips;
CREATE POLICY help_tooltips_org_admin_write ON public.help_tooltips FOR ALL TO authenticated
USING (organization_id IS NOT NULL AND (public.is_platform_admin() OR (public.user_is_member_of_org(organization_id) AND public.learning_user_can_manage())))
WITH CHECK (organization_id IS NOT NULL AND (public.is_platform_admin() OR (public.user_is_member_of_org(organization_id) AND public.learning_user_can_manage())));

DROP POLICY IF EXISTS guided_tours_read ON public.guided_tours;
CREATE POLICY guided_tours_read ON public.guided_tours FOR SELECT TO authenticated
USING (is_active AND (organization_id IS NULL OR public.user_is_member_of_org(organization_id) OR public.is_platform_admin()));
DROP POLICY IF EXISTS guided_tours_org_admin_write ON public.guided_tours;
CREATE POLICY guided_tours_org_admin_write ON public.guided_tours FOR ALL TO authenticated
USING (organization_id IS NOT NULL AND (public.is_platform_admin() OR (public.user_is_member_of_org(organization_id) AND public.learning_user_can_manage())))
WITH CHECK (organization_id IS NOT NULL AND (public.is_platform_admin() OR (public.user_is_member_of_org(organization_id) AND public.learning_user_can_manage())));

DROP POLICY IF EXISTS training_tasks_read ON public.training_tasks;
CREATE POLICY training_tasks_read ON public.training_tasks FOR SELECT TO authenticated
USING (is_active AND (organization_id IS NULL OR public.user_is_member_of_org(organization_id) OR public.is_platform_admin()));
DROP POLICY IF EXISTS training_tasks_org_admin_write ON public.training_tasks;
CREATE POLICY training_tasks_org_admin_write ON public.training_tasks FOR ALL TO authenticated
USING (organization_id IS NOT NULL AND (public.is_platform_admin() OR (public.user_is_member_of_org(organization_id) AND public.learning_user_can_manage())))
WITH CHECK (organization_id IS NOT NULL AND (public.is_platform_admin() OR (public.user_is_member_of_org(organization_id) AND public.learning_user_can_manage())));

DROP POLICY IF EXISTS guided_tour_steps_read ON public.guided_tour_steps;
CREATE POLICY guided_tour_steps_read ON public.guided_tour_steps FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.guided_tours t WHERE t.id=tour_id AND t.is_active AND (t.organization_id IS NULL OR public.user_is_member_of_org(t.organization_id) OR public.is_platform_admin())));

DROP POLICY IF EXISTS training_progress_own ON public.user_training_progress;
CREATE POLICY training_progress_own ON public.user_training_progress FOR ALL TO authenticated
USING (user_id=auth.uid() AND public.user_is_member_of_org(organization_id))
WITH CHECK (user_id=auth.uid() AND public.user_is_member_of_org(organization_id));

GRANT SELECT ON public.help_articles,public.help_tooltips,public.guided_tours,public.guided_tour_steps,public.training_tasks TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.user_training_progress TO authenticated;
GRANT INSERT,UPDATE,DELETE ON public.help_articles,public.help_tooltips,public.guided_tours,public.guided_tour_steps,public.training_tasks TO authenticated;

INSERT INTO public.help_articles(page_key,module_key,title,short_description,instructions,common_mistakes,related_guidance,troubleshooting)
VALUES
('practice_clients','practice','Set up a client','Create the client record used by engagements, documents, billing and reports.','["Confirm the legal name and client type.","Add primary contacts and communication details.","Complete tax and compliance identifiers before opening an engagement."]','["Creating duplicate client records","Starting work before required compliance details are captured"]','["Client acceptance and conflict checks","Opening balances"]','["If a client is not visible, confirm your organization and permissions."]'),
('data_migration','practice','Import opening balances','Bring approved opening balances into BOAT before normal processing begins.','["Download and complete the BOAT template.","Validate account codes and the effective date.","Confirm total debits equal total credits.","Preview exceptions before posting."]','["Importing an unbalanced file","Using transactions from a locked period"]','["Trial balance","Period controls"]','["Correct every validation row, then upload the revised file."]'),
('transactions','practice','Import accounting transactions','Validate and import transaction files without losing source-document traceability.','["Choose the correct client and period.","Upload the source file.","Map every required column.","Review duplicates and exceptions before import."]','["Mapping amounts to the wrong debit or credit field","Ignoring duplicate references"]','["Bank statement import","Adjustment journals"]','["Return to column mapping when a required field is blank."]'),
('accounting_bank_reconciliation','practice','Complete a bank reconciliation','Match BOAT cashbook activity to the bank statement and explain every difference.','["Select the bank account and statement period.","Enter the statement closing balance.","Match receipts and payments.","Investigate remaining differences and save the reconciliation."]','["Using the ledger balance as the statement balance","Leaving old unmatched items unexplained"]','["Bank statement mapping","Adjustment journals"]','["If the difference remains, verify opening balance, date range and duplicate entries."]'),
('accounting_manual','practice','Post adjustment journals','Record approved corrections and period-end adjustments with a complete audit trail.','["Select the correct client and accounting period.","Enter balanced debit and credit lines.","Attach supporting evidence.","Submit for review or post with the required approval."]','["Posting directly into a locked period","Using a suspense account without explanation"]','["Working papers","Review and approvals"]','["If the period is locked, request an authorized reopening or use the next permitted period."]'),
('practice_documents','practice','Prepare working papers','Store evidence that supports balances, judgements and conclusions.','["Choose the client and engagement.","Use the approved working-paper naming convention.","Link the paper to the relevant task or balance.","Resolve review notes before completion."]','["Uploading evidence to the wrong engagement","Completing a paper with unresolved review points"]','["Trial balance","Financial statements"]','["Check file type, size and engagement access if an upload fails."]'),
('accounting_trial','practice','Review the trial balance','Confirm the ledger is balanced and ready for financial-statement preparation.','["Select the correct client and reporting date.","Review unusual, negative and suspense balances.","Open supporting ledgers and working papers.","Resolve material exceptions before sign-off."]','["Reviewing the wrong period","Accepting unsupported balances"]','["Working papers","Financial statements"]','["Trace unexpected balances to journals and source transactions."]'),
('accounting_income','practice','Generate financial statements','Produce statements from the approved trial balance and mapped accounts.','["Confirm account mappings and reporting period.","Generate the draft statements.","Review comparatives, notes and rounding.","Submit the final draft for approval."]','["Generating statements before adjustments are approved","Leaving unmapped accounts"]','["Trial balance","Management reports"]','["Resolve unmapped or unsupported balances before regenerating."]'),
('reports','practice','Prepare management and board reports','Turn approved accounting information into concise management reporting.','["Choose the approved reporting period.","Review key movements and exceptions.","Add explanations supported by BOAT reports.","Resolve review points before issue."]','["Reporting from an incomplete period","Publishing with unresolved review notes"]','["Financial statements","Review and approvals"]','["Verify filters and posting status when totals differ from the trial balance."]'),
('practice_quality','practice','Review and approve work','Document review points, evidence, decisions and client sign-off.','["Open the engagement quality workspace.","Raise specific review notes against the relevant work.","Assign and resolve each point.","Record approval only after evidence is complete."]','["Approving work with open review notes","Using comments that do not explain the required correction"]','["Working papers","Client sign-off"]','["Reopen the assigned task if evidence must be replaced."]'),
('practice_tasks','practice','Close an accounting period','Protect approved records after reconciliation, review and reporting are complete.','["Confirm reconciliations and working papers are complete.","Verify journals and review points are approved.","Generate final reports and backups.","Close the period using authorized access."]','["Closing before all bank accounts are reconciled","Reopening without an audit reason"]','["Financial statements","Review and approvals"]','["Use the close checklist to identify the blocking item."]'),
('practice_dashboard','practice','Professional Practice overview','Monitor clients, engagements, deadlines, WIP and exceptions from one workspace.','["Review overdue and high-risk work first.","Open the relevant client or engagement.","Assign actions and monitor completion."]','["Treating dashboard alerts as accounting entries","Ignoring unassigned overdue work"]','["Clients","Engagements","Staff capacity"]','["Refresh filters and confirm access if expected work is missing."]')
ON CONFLICT (organization_id,page_key,version) DO UPDATE SET title=EXCLUDED.title,short_description=EXCLUDED.short_description,instructions=EXCLUDED.instructions,common_mistakes=EXCLUDED.common_mistakes,related_guidance=EXCLUDED.related_guidance,troubleshooting=EXCLUDED.troubleshooting,updated_at=now();

INSERT INTO public.help_tooltips(page_key,field_key,term,explanation) VALUES
('accounting_trial','trial_balance','Trial balance','A list of ledger account balances used to confirm total debits equal total credits.'),
('accounting_bank_reconciliation','reconciling_item','Reconciling item','A timing difference or error explaining why the bank statement and ledger balances differ.'),
('practice_finance','wip','Work in progress (WIP)','Time and costs recorded on client work that have not yet been billed or written off.'),
('accounting_manual','locked_period','Locked period','A completed accounting period where changes require authorized reopening or a later-period adjustment.')
ON CONFLICT (organization_id,page_key,field_key) DO UPDATE SET term=EXCLUDED.term,explanation=EXCLUDED.explanation;

INSERT INTO public.guided_tours(page_key,title,description)
VALUES ('practice_dashboard','Professional Practice quick tour','Learn how to move from an exception on the dashboard to the client work that needs attention.')
ON CONFLICT (organization_id,page_key,version) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,is_active=true;

INSERT INTO public.guided_tour_steps(tour_id,step_order,target_selector,title,body)
SELECT t.id,s.step_order,s.target_selector,s.title,s.body
FROM public.guided_tours t
CROSS JOIN (VALUES
  (1,NULL::text,'Start with exceptions','Review overdue work, unresolved review points and high-risk engagements first.'),
  (2,NULL::text,'Open the client or engagement','Move from the dashboard into the record that owns the work and evidence.'),
  (3,NULL::text,'Assign and monitor the action','Give the task a clear owner and due date, then monitor it until completion.')
) s(step_order,target_selector,title,body)
WHERE t.organization_id IS NULL AND t.page_key='practice_dashboard' AND t.version=1
ON CONFLICT (tour_id,step_order) DO UPDATE SET target_selector=EXCLUDED.target_selector,title=EXCLUDED.title,body=EXCLUDED.body;

INSERT INTO public.training_tasks(module_key,page_key,title,instructions,success_criteria,task_order,points)
VALUES
('practice','practice_clients','Create a training client','Create Kampala Traders Ltd - Training Account with a primary contact and complete identification details.','["Client is clearly marked as training","Primary contact is present","Required identifiers are complete"]',1,10),
('practice','accounting_bank_reconciliation','Match the UGX 850,000 deposit','Match the UGX 850,000 bank deposit to invoice INV-0045 in the protected training account.','["Correct deposit and invoice are matched","Reconciliation difference is unchanged or reduced","No live client record is affected"]',2,20),
('practice','accounting_manual','Correct the deliberate posting error','Prepare an adjustment journal for the deliberate training error and attach supporting evidence.','["Journal balances","Explanation is clear","Evidence is attached","Training period only"]',3,20)
ON CONFLICT (organization_id,module_key,page_key,title) DO UPDATE SET instructions=EXCLUDED.instructions,success_criteria=EXCLUDED.success_criteria,task_order=EXCLUDED.task_order,points=EXCLUDED.points,is_active=true;
